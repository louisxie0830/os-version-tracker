# 第三方套件授權

本專案執行時使用下列 npm 套件。這些套件透過 npm 安裝，不收錄在本專案的原始碼中；Docker 映像會連同各套件自帶的授權檔
（`node_modules/<套件>/LICENSE`）一起收錄。著作權屬於各自的作者，依各自的授權條款使用。

| 套件 | 版本 | 授權 | 來源 |
| --- | --- | --- | --- |
| rss-parser | 3.13.0 | MIT | <https://github.com/bobby-brennan/rss-parser> |
| xml2js | 0.5.0 | MIT | <https://github.com/Leonidas-from-XIV/node-xml2js> |
| xmlbuilder | 11.0.1 | MIT | <https://github.com/oozcitak/xmlbuilder-js> |
| sax | 1.5.0 | BlueOak-1.0.0 | <https://github.com/isaacs/sax-js> |
| entities | 2.2.0 | BSD-2-Clause | <https://github.com/fb55/entities> |

開發與測試用的工具（TypeScript、tsx、@types/node）只在建置與測試時使用，不會部署到網站，依各自的授權條款使用。

網站本身只使用自行撰寫的前端程式（`public/`），不載入任何第三方前端程式、字型或樣式。

本清單由 `npm ls --omit=dev --all` 整理；更新相依套件時請一併更新（有測試會比對清單與實際安裝的套件）。
