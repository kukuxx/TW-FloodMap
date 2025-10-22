[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![License][license-shield]][license-url]

[contributors-shield]: https://img.shields.io/github/contributors/kukuxx/TW-FloodMap.svg?style=for-the-badge
[contributors-url]: https://github.com/kukuxx/TW-FloodMap/graphs/contributors

[forks-shield]: https://img.shields.io/github/forks/kukuxx/TW-FloodMap.svg?style=for-the-badge
[forks-url]: https://github.com/kukuxx/TW-FloodMap/network/members

[stars-shield]: https://img.shields.io/github/stars/kukuxx/TW-FloodMap.svg?style=for-the-badge
[stars-url]: https://github.com/kukuxx/TW-FloodMap/stargazers

[issues-shield]: https://img.shields.io/github/issues/kukuxx/TW-FloodMap.svg?style=for-the-badge
[issues-url]: https://github.com/kukuxx/TW-FloodMap/issues

[license-shield]: https://img.shields.io/github/license/kukuxx/TW-FloodMap.svg?style=for-the-badge
[license-url]: https://github.com/kukuxx/TW-FloodMap/blob/main/LICENSE

---

# 🌊 台灣淹水感測器即時監測地圖

[English](/README.md) | [繁體中文](/README-zh-TW.md)

一個基於 Leaflet.js 的地圖應用程式，即時顯示台灣各地淹水感測器的監測數據。

## 🎯 淹水深度顏色標示

| 顏色 | 說明 | 深度範圍 |
|------|-----|----------|
| ⚪ | 灰色 | 無資料 |
| 🔵 | 藍色 | < 1 公分 |
| 🟢 | 綠色 | < 10 公分 |
| 🟡 | 黃色 | 10-30 公分 |
| 🟠 | 橘色 | 30-50 公分 |
| 🔴 | 紅色 | > 50 公分 |

## 📡 資料來源

本專案使用民生公共物聯網 SensorThings API 提供的即時資料：

1. **水利署自建感測器**
   - API: `https://sta.ci.taiwan.gov.tw/STA_WaterResource_v2/v1.0/Datastreams`
   - 篩選條件：`authority_type eq '水利署'`

2. **水利署與縣市政府合建感測器**
   - API: `https://sta.ci.taiwan.gov.tw/STA_WaterResource_v2/v1.0/Datastreams`
   - 篩選條件：`authority_type eq '水利署(與縣市政府合建)'`

## 📄 授權

本專案採用 Apache License 2.0 授權條款。

## 📧 聯絡資訊

如有任何問題或建議，歡迎開啟 Issue 或 Pull Request。

---