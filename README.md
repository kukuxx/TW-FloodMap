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

# 🌊 Taiwan Flood Sensor Real-Time Monitoring Map

[English](/README.md) | [繁體中文](/README-zh-TW.md)

A map application based on Leaflet.js that displays real-time monitoring data from flood sensors across Taiwan.

## 🎯 Flood Depth Color Coding

| Color | Description | Depth Range |
| ----- | ----------- | ----------- |
| ⚪     | Gray        | No data     |
| 🔵    | Blue        | < 1 cm      |
| 🟢    | Green       | < 10 cm     |
| 🟡    | Yellow      | 10–30 cm    |
| 🟠    | Orange      | 30–50 cm    |
| 🔴    | Red         | > 50 cm     |

## 📡 Data Sources

This project uses real-time data provided by the Public IoT SensorThings API:

1. **Sensors built by the Water Resources Agency**

   * API: `https://sta.ci.taiwan.gov.tw/STA_WaterResource_v2/v1.0/Datastreams`
   * Filter: `authority_type eq '水利署'`

2. **Sensors co-built by the Water Resources Agency and local governments**

   * API: `https://sta.ci.taiwan.gov.tw/STA_WaterResource_v2/v1.0/Datastreams`
   * Filter: `authority_type eq '水利署(與縣市政府合建)'`

## 📄 License

This project is licensed under the Apache License 2.0.

## 📧 Contact

If you have any questions or suggestions, feel free to open an Issue or Pull Request.

---