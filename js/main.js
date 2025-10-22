/**
 * 主程式 - 地圖初始化與 UI 控制
 */

// ========== 全域變數 ==========
let map;
let markerClusterGroup;  // 用於 ≥10 個 marker 的群組
let normalMarkerGroup;   // 用於 <10 個 marker 的群組
let userLocationMarker;
let allSensorsData = [];
let currentRenderingTask = null; // 當前渲染任務（用於取消）

// ========== 空間分群函式 ==========
/**
 * 將感測器依據地理位置分群
 * @param {Array} sensors - 感測器陣列
 * @param {number} gridSize - 網格大小（經緯度精度，例如 0.01 約 1km）
 * @returns {Object} - { clustered: [], normal: [] }
 */
function spatialGrouping(sensors, gridSize = 0.01) {
    console.log(`[Main] 開始空間分群，網格大小: ${gridSize} 度`);

    // 使用 Map 儲存每個網格的 markers
    const gridBuckets = new Map();

    sensors.forEach(sensor => {
        // 將經緯度四捨五入到指定精度
        const latKey = Math.round(sensor.latitude / gridSize) * gridSize;
        const lngKey = Math.round(sensor.longitude / gridSize) * gridSize;
        const bucketKey = `${latKey.toFixed(4)},${lngKey.toFixed(4)}`;

        if (!gridBuckets.has(bucketKey)) {
            gridBuckets.set(bucketKey, []);
        }
        gridBuckets.get(bucketKey).push(sensor);
    });

    // 分類：≥10 個的放入 clustered，<10 個的放入 normal
    const clustered = [];
    const normal = [];

    gridBuckets.forEach((bucket) => {
        if (bucket.length >= 10) {
            clustered.push(...bucket);
        } else {
            normal.push(...bucket);
        }
    });

    console.log(`[Main] 分群結果: ${clustered.length} 個需群集, ${normal.length} 個直接顯示`);
    console.log(`[Main] 網格數量: ${gridBuckets.size}, 需群集的網格: ${Array.from(gridBuckets.values()).filter(b => b.length >= 10).length}`);

    return { clustered, normal };
}

// ========== 建立自訂 marker icon ==========
function createMarkerIcon(sensor) {
    const color = window.FloodSensors.getDepthColor(sensor.depth);

    // 根據來源類型決定邊框樣式
    const borderStyle = sensor.authorityType === '水利署'
        ? 'border: 3px solid #103b99;'
        : 'border: 3px solid #9333EA;';

    return L.divIcon({
        className: 'custom-marker-icon',
        html: `<div style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50%; ${borderStyle} box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
    });
}

// ========== 建立 Popup 內容 ==========
function createPopupContent(sensor) {
    const template = document.getElementById('template-popup');
    const popupElement = template.content.cloneNode(true).firstElementChild;

    // 格式化時間
    let formattedTime = '無資料';
    if (sensor.phenomenonTime) {
        try {
            const date = new Date(sensor.phenomenonTime);
            formattedTime = date.toLocaleString('zh-TW', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            formattedTime = sensor.phenomenonTime;
        }
    }

    // 格式化深度值
    let depthDisplay = '無資料';
    if (sensor.depth !== null && sensor.depth !== undefined && !isNaN(sensor.depth)) {
        depthDisplay = `${sensor.depth.toFixed(2)} ${sensor.unit}`;
    }

    // 更新模板中的數值（使用 data-field 屬性）
    popupElement.querySelector('[data-field="name"]').textContent = sensor.stationName;
    popupElement.querySelector('[data-field="id"]').textContent = sensor.stationId;
    popupElement.querySelector('[data-field="code"]').textContent = sensor.stationCode;
    popupElement.querySelector('[data-field="depth"]').textContent = depthDisplay;
    popupElement.querySelector('[data-field="time"]').textContent = formattedTime;
    popupElement.querySelector('[data-field="source"]').textContent = sensor.authorityType;

    // 設定深度顏色
    const depthElement = popupElement.querySelector('.popup-depth');
    const depthColor = window.FloodSensors.getDepthColor(sensor.depth);
    depthElement.style.color = depthColor;

    // 設定來源顏色
    const sourceElement = popupElement.querySelector('.popup-source');
    const sourceColor = sensor.authorityType === '水利署' ? 'rgba(5, 37, 106, 1)' : 'rgba(147, 51, 234, 1)';
    sourceElement.style.color = sourceColor;
    sourceElement.style.backgroundColor = sourceColor.replace(', 1)', ', 0.20)'); // 20% 透明度

    // 返回 HTML 字串（Leaflet Popup 需要字串）
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(popupElement);
    return tempDiv.innerHTML;
}

// ========== 分批渲染 marker ==========
/**
 * 分批渲染 marker，避免阻塞主執行緒
 * @param {Array} sensors - 感測器陣列
 * @param {Object} targetGroup - 目標圖層群組（cluster 或 normal）
 * @param {number} batchSize - 每批處理的數量
 * @returns {Promise} 渲染完成的 Promise
 */
function renderMarkersBatch(sensors, targetGroup, batchSize = 100) {
    return new Promise((resolve) => {
        let index = 0;
        const markers = []; // 暫存 marker，稍後批次綁定 popup
        const bounds = [];

        function processBatch() {
            const endIndex = Math.min(index + batchSize, sensors.length);

            // 處理當前批次
            for (let i = index; i < endIndex; i++) {
                const sensor = sensors[i];
                try {
                    const icon = createMarkerIcon(sensor);
                    const marker = L.marker([sensor.latitude, sensor.longitude], { icon: icon });

                    // 先不綁定 popup，稍後批次綁定
                    marker._sensorData = sensor; // 暫存資料
                    markers.push(marker);

                    targetGroup.addLayer(marker);
                    bounds.push([sensor.latitude, sensor.longitude]);
                } catch (error) {
                    console.error(`[Main] 建立 marker 失敗 (索引 ${i}):`, error);
                }
            }

            index = endIndex;

            // 如果還有資料，繼續下一批
            if (index < sensors.length) {
                requestAnimationFrame(processBatch);
            } else {
                // 所有 marker 渲染完成，延遲綁定 popup
                setTimeout(() => {
                    bindPopupsToMarkers(markers);
                    resolve(bounds);
                }, 300); // 延遲 300ms 綁定 popup
            }
        }

        // 開始第一批
        requestAnimationFrame(processBatch);
    });
}

/**
 * 批次綁定 popup 到 markers
 * @param {Array} markers - marker 陣列
 */
function bindPopupsToMarkers(markers) {
    console.log(`[Main] 開始綁定 ${markers.length} 個 popup...`);

    markers.forEach(marker => {
        if (marker._sensorData) {
            const popupContent = createPopupContent(marker._sensorData);
            marker.bindPopup(popupContent);
            delete marker._sensorData; // 清除暫存資料
        }
    });

    console.log('[Main] ✓ Popup 綁定完成');
}

// ========== 在地圖上顯示感測器 ==========
async function displaySensors(data) {
    console.log('[Main] 開始顯示感測器...');

    // 取消之前的渲染任務
    if (currentRenderingTask) {
        currentRenderingTask.cancelled = true;
    }

    // 清除現有的 markers
    markerClusterGroup.clearLayers();
    normalMarkerGroup.clearLayers();

    const { sensors, stats, fromCache } = data;
    allSensorsData = sensors;

    if (sensors.length === 0) {
        console.warn('[Main] 沒有感測器資料可顯示');
        if (!fromCache) {
            alert('無法載入感測器資料，請檢查網路連線或稍後再試');
        }
        return;
    }

    console.log(`[Main] 資料來源: ${fromCache ? '快取' : 'API'}`);

    // 將感測器分為兩組：需要群集的（≥10）和直接顯示的（<10）
    const { clustered, normal } = spatialGrouping(sensors, 0.01);

    // 建立渲染任務
    currentRenderingTask = { cancelled: false };

    try {
        // 分批渲染（並行處理兩個群組）
        const [clusterBounds, normalBounds] = await Promise.all([
            renderMarkersBatch(clustered, markerClusterGroup, 100),
            renderMarkersBatch(normal, normalMarkerGroup, 100)
        ]);

        // 檢查是否被取消
        if (currentRenderingTask.cancelled) {
            console.log('[Main] 渲染已取消');
            return;
        }

        const allBounds = [...clusterBounds, ...normalBounds];

        console.log(`[Main] ✓ 成功顯示 ${sensors.length} 個感測器 (群集: ${clustered.length}, 直接: ${normal.length})`);

        // 自動調整地圖視野以顯示所有 markers
        if (allBounds.length > 0) {
            map.fitBounds(allBounds, { padding: [50, 50] });
        }

        // 更新統計資訊
        updateStats(stats);

    } catch (error) {
        console.error('[Main] 渲染失敗:', error);
    } finally {
        currentRenderingTask = null;
    }
}

// ========== 更新統計資訊 ==========
function updateStats(stats) {
    document.getElementById('totalCount').textContent = stats.total;
    document.getElementById('wraCount').textContent = stats.wra;
    document.getElementById('jointCount').textContent = stats.joint;
    document.getElementById('updateTime').textContent = new Date().toLocaleTimeString('zh-TW');

    console.log('[Main] 統計資訊已更新:', stats);
}

// ========== 使用者定位功能 ==========
function locateUser() {
    console.log('[Main] 嘗試定位使用者...');

    if (!navigator.geolocation) {
        alert('您的瀏覽器不支援定位功能');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            console.log(`[Main] 定位成功: ${latitude}, ${longitude}`);

            // 移除舊的使用者位置 marker
            if (userLocationMarker) {
                map.removeLayer(userLocationMarker);
            }

            // 建立使用者位置 marker
            userLocationMarker = L.marker([latitude, longitude], {
                icon: L.divIcon({
                    className: 'user-location-icon',
                    html: '<div style="background-color: #3B82F6; width: 18px; height: 18px; border-radius: 50%; border: 4px solid white; box-shadow: 0 0 12px rgba(59, 130, 246, 0.6);"></div>',
                    iconSize: [18, 18],
                    iconAnchor: [9, 9]
                })
            }).addTo(map);

            userLocationMarker.bindPopup('<strong>您的位置</strong>').openPopup();

            // 移動地圖到使用者位置
            map.setView([latitude, longitude], 13);
        },
        (error) => {
            console.error('[Main] 定位失敗:', error);
            alert('無法取得您的位置，請確認已允許瀏覽器存取位置資訊');
        }
    );
}

// ========== 重新整理資料 ==========
async function refreshData() {
    console.log('[Main] 重新整理資料...');

    const refreshBtn = document.getElementById('refreshBtn');
    const originalHTML = refreshBtn.innerHTML;

    // 顯示載入狀態
    refreshBtn.innerHTML = '<svg class="animate-spin h-5 w-5 mx-auto" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
    refreshBtn.disabled = true;

    try {
        // 強制從 API 載入（不使用快取）
        const data = await window.FloodSensors.fetchAllSensors(false);
        await displaySensors(data);
    } catch (error) {
        console.error('[Main] 重新整理失敗:', error);
        alert('重新整理失敗，請稍後再試');
    } finally {
        // 恢復按鈕狀態
        refreshBtn.innerHTML = originalHTML;
        refreshBtn.disabled = false;
    }
}

// ========== Leaflet 自訂控制項：整合容器（包含三個子控制項） ==========
L.Control.CustomContainer = L.Control.extend({
    options: {
        position: 'topright'
    },

    onAdd: function (map) {
        // 從 HTML 模板 clone 整合容器
        const template = document.getElementById('template-control-container');
        const container = template.content.cloneNode(true).firstElementChild;

        // 加入 Leaflet 控制項類別
        container.classList.add('leaflet-bar', 'leaflet-control');

        // 防止點擊事件傳遞到地圖
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        // 綁定操作按鈕事件（延遲以確保 DOM 已加入）
        setTimeout(() => {
            const locateBtn = container.querySelector('#locateBtn');
            const refreshBtn = container.querySelector('#refreshBtn');

            if (locateBtn) {
                locateBtn.addEventListener('click', locateUser);
            }

            if (refreshBtn) {
                refreshBtn.addEventListener('click', refreshData);
            }
        }, 100);

        return container;
    }
});

// ========== 地圖初始化 ==========
function initMap() {
    console.log('[Main] 初始化地圖...');

    // 建立地圖實例，中心點設在台灣中部
    map = L.map('map', {
        center: [23.97, 120.98],
        zoom: 9,
        zoomControl: true,
        minZoom: 7.5,
        maxZoom: 18
    });

    // 加入 OpenStreetMap 底圖
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);

    // 初始化 marker cluster 群組（只用於 ≥10 個 marker 的區域）
    markerClusterGroup = L.markerClusterGroup({
        maxClusterRadius: 80,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 15,

        // 自訂 cluster icon（使用藍灰色系）
        iconCreateFunction: function (cluster) {
            const childCount = cluster.getChildCount();
            let sizeClass = 'marker-cluster-small';

            if (childCount >= 100) {
                sizeClass = 'marker-cluster-large';
            } else if (childCount >= 50) {
                sizeClass = 'marker-cluster-medium';
            }

            return new L.DivIcon({
                html: `<div class="cluster-inner"><span>${childCount}</span></div>`,
                className: 'marker-cluster ' + sizeClass,
                iconSize: new L.Point(40, 40)
            });
        }
    });

    // 初始化普通 marker 群組（用於 <10 個 marker 的區域）
    normalMarkerGroup = L.layerGroup();

    // 將兩個群組都加入地圖
    map.addLayer(markerClusterGroup);
    map.addLayer(normalMarkerGroup);

    // ========== 加入整合控制項容器（包含操作按鈕、圖例、統計資訊） ==========
    const customContainer = new L.Control.CustomContainer();
    customContainer.addTo(map);

    console.log('[Main] 地圖初始化完成');
}

// ========== 初始化應用程式 ==========
async function initApp() {
    console.log('[Main] ========== 應用程式啟動 ==========');

    try {
        // 初始化地圖（先顯示底圖，不等資料）
        initMap();
        console.log('[Main] ✓ 地圖底圖已顯示');

        // 檢查快取，如果有就顯示
        const cachedData = window.FloodSensors.getCachedData();
        if (cachedData) {
            console.log('[Main] 發現快取資料，正在顯示...');
            await displaySensors({
                sensors: cachedData.sensors,
                stats: cachedData.stats,
                fromCache: true
            });
        }
        else {
            // 發起 API 請求
            console.log('[Main] 開始載入最新資料...');
            const data = await window.FloodSensors.fetchAllSensors(false);
            await displaySensors(data);
        }

        // 隱藏載入覆蓋層
        document.getElementById('loadingOverlay').style.display = 'none';

        console.log('[Main] ========== 應用程式啟動完成 ==========');

    } catch (error) {
        console.error('[Main] ========== 應用程式啟動失敗 ==========');
        console.error('[Main] 錯誤:', error);

        // 隱藏載入覆蓋層並顯示錯誤訊息
        document.getElementById('loadingOverlay').innerHTML = `
            <div class="text-center">
                <div class="text-red-600 text-xl mb-4">⚠️ 載入失敗</div>
                <p class="text-gray-700">${error.message}</p>
                <button onclick="location.reload()" class="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">
                    重新載入
                </button>
            </div>
        `;
    }
}

// ========== 頁面載入完成後執行 ==========
window.addEventListener('DOMContentLoaded', initApp);
console.log('[Main] 主程式已載入');

