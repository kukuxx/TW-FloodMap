/**
 * 淹水感測器資料擷取模組
 * 負責從水利署 API 擷取感測器資料並進行整合處理
 */

// 全域 AbortController（用於取消請求）
let currentAbortController = null;
const API_PAGE_SIZE = 300;

// API 端點配置
const API_CONFIG = {
    // 水利署自建感測器
    wra: "https://sta.colife.org.tw/STA_WaterResource_v2/v1.0/Datastreams" +
        "?$top=300" +
        "&$skip=0" +
        "&$filter=(" +
        "(Thing/properties/authority_type eq '水利署')" +
        " and substringof('Datastream_Category_type=淹水感測器',description)" +
        " and substringof('Datastream_Category=淹水深度',description)" +
        ")" +
        "&$expand=" +
        "Thing($expand=Locations;$orderby=@iot.id asc)," +
        "Observations($top=1;$skip=0;$orderby=phenomenonTime desc,@iot.id asc)" +
        "&$orderby=@iot.id asc" +
        "&$count=true",

    // 水利署與縣市政府合建感測器
    joint: "https://sta.colife.org.tw/STA_WaterResource_v2/v1.0/Datastreams" +
        "?$top=300" +
        "&$skip=0" +
        "&$filter=(" +
        "(Thing/properties/authority_type eq '水利署（與縣市政府合建）')" +
        " and substringof('Datastream_Category_type=淹水感測器',description)" +
        " and substringof('Datastream_Category=淹水深度',description)" +
        ")" +
        "&$expand=" +
        "Thing($expand=Locations;$orderby=@iot.id asc)," +
        "Observations($top=1;$skip=0;$orderby=phenomenonTime desc,@iot.id asc)" +
        "&$orderby=@iot.id asc" +
        "&$count=true"
};

// 快取配置
const CACHE_CONFIG = {
    key: 'floodSensorsCache',
    maxAge: 3 * 60 * 1000 // 3 分鐘
};

// ========== 快取管理函式 ==========
/**
 * 從 localStorage 讀取快取資料
 * @returns {Object|null} 快取資料或 null
 */
function getCachedData() {
    try {
        const cached = localStorage.getItem(CACHE_CONFIG.key);
        if (!cached) return null;

        const data = JSON.parse(cached);

        // 檢查快取是否過期
        if (Date.now() - data.timestamp > CACHE_CONFIG.maxAge) {
            console.log('[FloodSensors] 快取已過期');
            localStorage.removeItem(CACHE_CONFIG.key);
            return null;
        }

        console.log('[FloodSensors] ✓ 使用快取資料', {
            age: Math.round((Date.now() - data.timestamp) / 1000) + '秒前',
            sensors: data.sensors.length
        });
        return data;
    } catch (error) {
        console.error('[FloodSensors] 讀取快取失敗:', error);
        return null;
    }
}

/**
 * 儲存資料到 localStorage
 * @param {Object} data - 要快取的資料
 */
function setCachedData(data) {
    try {
        const cacheData = {
            sensors: data.sensors,
            stats: data.stats,
            timestamp: Date.now()
        };
        localStorage.setItem(CACHE_CONFIG.key, JSON.stringify(cacheData));
        console.log('[FloodSensors] ✓ 資料已快取');
    } catch (error) {
        console.error('[FloodSensors] 快取儲存失敗:', error);
        // localStorage 可能已滿，嘗試清除舊資料
        try {
            localStorage.removeItem(CACHE_CONFIG.key);
        } catch (e) {
            // 忽略錯誤
        }
    }
}

// ========== API 請求資料清理函式 ==========
/**
 * 解析座標資料，並檢查緯度與經度的順序
 * @param {Array} coords - 座標陣列 [a, b]
 * @returns {Object|null} 解析後的座標物件 { lat, lon }，若無法解析則返回 null
 */
function parseCoordinates(coords) {
    // 緯度與經度的合理範圍
    const latRange = [10.36, 26.40];
    const lonRange = [114.35, 122.11];

    const [a, b] = coords;

    if (a >= latRange[0] && a <= latRange[1] && b >= lonRange[0] && b <= lonRange[1]) {
        // a 是緯度、b 是經度
        return { lat: a, lon: b };
    } else if (b >= latRange[0] && b <= latRange[1] && a >= lonRange[0] && a <= lonRange[1]) {
        // b 是緯度、a 是經度（順序顛倒）
        return { lat: b, lon: a };
    } else {
        // 超出範圍
        return null;
    }
}

/**
 * 驗證並處理單一感測器資料
 * @param {Object} sensor - 原始感測器資料
 * @param {string} authorityType - 權責機關類型
 * @returns {Object|null} 處理後的感測器資料，若無效則返回 null
 */
function processSensor(sensor, authorityType) {
    try {
        // 檢查必要欄位
        const properties = sensor.Thing?.properties;
        const locations = sensor.Thing?.Locations;
        const coordinates = locations?.[0]?.location?.coordinates;

        if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
            return null;
        }

        // 驗證座標範圍（台灣地區）
        const parsedCoords = parseCoordinates(coordinates);
        if (!parsedCoords) {
            return null;
        }

        // 取得觀測資料
        const latestObservation = sensor.Observations?.[0];

        // 只返回必要欄位
        return {
            stationId: properties?.stationID,
            stationCode: properties?.stationCode,
            stationName: properties?.stationName,
            authorityType: authorityType,
            latitude: parsedCoords.lat,
            longitude: parsedCoords.lon,
            depth: latestObservation?.result,
            unit: sensor.unitOfMeasurement?.symbol || 'cm',
            phenomenonTime: latestObservation?.phenomenonTime
        };

    } catch (error) {
        return null;
    }
}

/**
 * 從單一 API 端點擷取資料(並行分頁請求)
 * @param {string} url - API URL
 * @param {string} sourceType - 資料來源類型(用於 debug)
 * @param {AbortSignal} signal - AbortController 信號
 * @returns {Promise<Array>} 感測器資料陣列
 */
async function fetchFromAPI(url, sourceType, signal) {
    console.log(`[FloodSensors] 開始擷取 ${sourceType} 資料...`);
    const startTime = Date.now();
    const allData = [];

    try {
        // 第一次請求:取得總筆數
        const firstResponse = await Promise.race([
            fetch(url, { signal }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('首次請求逾時')), 15000))
        ]);

        if (!firstResponse.ok) {
            throw new Error(`HTTP ${firstResponse.status}: ${firstResponse.statusText}`);
        }

        const firstData = await firstResponse.json();
        allData.push(firstData.value); // 先加入第一頁資料

        if (!firstData.value || !Array.isArray(firstData.value)) {
            console.warn(`[FloodSensors] ${sourceType} 回應格式異常`);
            return [];
        }

        const totalCount = firstData['@iot.count'];

        if (!totalCount) {
            console.warn(`[FloodSensors] ${sourceType} 無法取得總筆數,僅返回第一頁`);
            return allData.flat();
        }

        console.log(`[FloodSensors] ${sourceType} 總筆數: ${totalCount}`);

        // 如果只有一頁,直接返回
        const totalPages = Math.ceil(totalCount / API_PAGE_SIZE);
        if (totalPages === 1) {
            console.log(`[FloodSensors] ✓ ${sourceType} 擷取完成,共 ${firstData.value.length} 筆 (單頁) - 耗時 ${Date.now() - startTime}ms`);
            return allData.flat();
        }

        // 建立所有分頁的 URL (從第2頁開始)
        const pageUrls = [];
        for (let i = 1; i < totalPages; i++) {
            const skip = i * API_PAGE_SIZE;
            // 替換或新增 $skip 參數
            let pageUrl;
            pageUrl = url.replace(/\$skip=\d+/, `$skip=${skip}`);
            pageUrls.push(pageUrl);
        }

        console.log(`[FloodSensors] ${sourceType} 準備並行請求剩餘 ${totalPages - 1} 分頁...`);

        // 分批並行請求(每批最多 10 個,避免伺服器限流)
        const batchSize = 10;

        for (let i = 0; i < pageUrls.length; i += batchSize) {
            const batch = pageUrls.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(pageUrls.length / batchSize);

            console.log(`[FloodSensors] ${sourceType} 正在處理第 ${batchNumber}/${totalBatches} 批 (${batch.length} 個請求)...`);

            const batchResults = await Promise.all(
                batch.map(async (pageUrl, index) => {
                    try {
                        const response = await Promise.race([
                            fetch(pageUrl, { signal }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('分頁請求逾時')), 15000))
                        ]);

                        if (!response.ok) {
                            console.warn(`[FloodSensors] ${sourceType} 第 ${i + index + 2} 頁請求失敗: HTTP ${response.status}`);
                            return [];
                        }

                        const data = await response.json();
                        return data.value || [];

                    } catch (error) {
                        if (error.name !== 'AbortError') {
                            console.warn(`[FloodSensors] ${sourceType} 第 ${i + index + 2} 頁擷取失敗:`, error.message);
                        }
                        return [];
                    }
                })
            );

            allData.push(...batchResults);

            // 批次間稍微延遲,避免過於密集的請求
            if (i + batchSize < pageUrls.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        const elapsed = Date.now() - startTime;

        console.log(`[FloodSensors] ✓ ${sourceType} 擷取完成,共 ${allData.length} 筆 (${totalPages} 頁並行) - 耗時 ${elapsed}ms`);
        return allData.flat();

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log(`[FloodSensors] ${sourceType} 請求已取消`);
        } else {
            console.error(`[FloodSensors] ✗ ${sourceType} 擷取失敗:`, error.message);
        }
        return allData.flat();
    }
}

// ========== 整合資料函式 ==========
/**
 * 根據淹水深度取得顏色
 * @param {number|null} depth - 淹水深度（公分）
 * @returns {string} 顏色代碼
 */
function getDepthColor(depth) {
    if (depth === null || depth === undefined || isNaN(depth)) {
        return '#9CA3AF'; // 灰色 - 無資料
    }
    if (depth < 1) return '#77a9faff'; // 藍色
    if (depth < 10) return '#10B981'; // 綠色
    if (depth < 30) return '#d6f50bff'; // 黃色
    if (depth < 50) return '#f18538ff'; // 橘色
    return '#cb0d0dff'; // 紅色
}

/**
 * 擷取並整合所有感測器資料
 * @param {boolean} useCache - 是否優先使用快取
 * @returns {Promise<Object>} 包含感測器陣列與統計資訊的物件
 */
async function fetchAllSensors(useCache = true) {
    console.log('[FloodSensors] ========== 開始擷取感測器資料 ==========');

    // 優先檢查快取
    if (useCache) {
        const cached = getCachedData();
        if (cached) {
            return {
                sensors: cached.sensors,
                stats: cached.stats,
                timestamp: new Date(cached.timestamp).toISOString(),
                fromCache: true
            };
        }
    }

    // 取消之前的請求（如果有）
    if (currentAbortController) {
        currentAbortController.abort();
    }

    // 建立新的 AbortController
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
        // 並行呼叫兩個 API
        const [wraData, jointData] = await Promise.all([
            fetchFromAPI(API_CONFIG.wra, '水利署自建', signal),
            fetchFromAPI(API_CONFIG.joint, '縣市合建', signal)
        ]);

        console.log('[FloodSensors] API 擷取完成，處理資料中...');

        // 處理感測器資料（使用 filter + map 減少迴圈次數）
        const wraSensors = wraData
            .map(sensor => processSensor(sensor, '水利署'))
            .filter(Boolean); // 過濾 null

        const jointSensors = jointData
            .map(sensor => processSensor(sensor, '水利署（與縣市政府合建）'))
            .filter(Boolean);

        console.log(`[FloodSensors] 處理完成: 水利署 ${wraSensors.length} 筆, 縣市 ${jointSensors.length} 筆`);

        // 整合所有感測器
        const allSensors = [...wraSensors, ...jointSensors];

        // 統計資訊
        const stats = {
            total: allSensors.length,
            wra: wraSensors.length,
            joint: jointSensors.length,
            withData: allSensors.filter(s => s.depth != null).length,
            noData: allSensors.filter(s => s.depth == null).length
        };

        const result = {
            sensors: allSensors,
            stats: stats,
            timestamp: new Date().toISOString(),
            fromCache: false
        };

        // 儲存到快取
        setCachedData(result);

        console.log('[FloodSensors] ========== 資料擷取完成 ==========');
        console.log('[FloodSensors] 統計:', stats);

        return result;

    } catch (error) {
        console.error('[FloodSensors] ========== 擷取失敗 ==========');
        console.error('[FloodSensors] 錯誤:', error.message);

        // 如果失敗，嘗試返回快取資料
        const cached = getCachedData();
        if (cached) {
            console.log('[FloodSensors] 使用快取資料作為備援');
            return {
                sensors: cached.sensors,
                stats: cached.stats,
                timestamp: new Date(cached.timestamp).toISOString(),
                fromCache: true,
                error: error.message
            };
        }

        return {
            sensors: [],
            stats: { total: 0, wra: 0, joint: 0, withData: 0, noData: 0 },
            timestamp: new Date().toISOString(),
            error: error.message
        };
    }
}

// 匯出函式供外部使用
window.FloodSensors = {
    fetchAllSensors,
    getDepthColor,
    getCachedData,
    clearCache: () => localStorage.removeItem(CACHE_CONFIG.key)
};

console.log('[FloodSensors] 模組已載入');

