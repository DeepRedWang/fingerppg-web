# FingerPPG 网页版

手机摄像头 → 红通道 primary 波形 → 心率估计，全部在浏览器本地处理。支持实时曲线、相机选择、实际到帧率、72 bpm 演示、波形/RGB/参数导出；不启用补光灯，不上传视频。

## 在 GitHub Pages 使用

1. 把本目录的全部文件放到一个 GitHub 仓库的根目录，保证 `index.html` 在根目录。
2. 打开仓库 **Settings → Pages**，在 Source 选择 **Deploy from a branch**。
3. 选择放置这些文件的分支（通常是 `main`）和 **/(root)**，保存。
4. 等待 Pages 页面显示站点地址。手机通过该 **HTTPS 地址**打开，点击“开始采集”并允许相机权限。

项目网址通常为 `https://你的用户名.github.io/仓库名/`。GitHub Pages 可以托管这些静态文件，并提供 HTTPS；GitHub Free 可用于公开仓库。参见 [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[发布目录设置](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)及 [HTTPS 说明](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)。

## 使用

- 先点击“体验 72 bpm 演示”检查曲线与读数；演示明确标注为合成数据，不调用相机。
- 真正采集时轻覆正在使用的后置镜头，保持稳定的环境光。首次估计通常需要 8–10 秒。
- 相机选择在停止后可修改。画面太暗、手指判定无效或波形不稳定时心率留空。
- “下载数据”会先停止采集，再导出选择的 CSV 或 JSON。原始 RGB 文件记录每个实际送入算法的帧；主 CSV 记录 60 Hz 重采样后的波形与心率。
- 单次最多 5 分钟；切到后台停止相机。当前会话只保存在页面内存中，重新开始、刷新或关闭前请下载需要的数据。
- 手机优先使用 Safari 或 Chrome；微信内置浏览器若无法采集，请在系统浏览器打开同一个 HTTPS 地址。

算法使用因果滤波、峰间隔中位数和频谱一致性检查，搜索范围 40–200 bpm。它尚未与参考心率作真机对照；60 Hz 是处理网格，不是对设备帧率的保证。时间戳为浏览器帧回调时刻，不是硬件曝光时间。

本程序无业务服务器、云函数或数据库。GitHub 仅托管网页文件，用户拍摄的视频不会发送给 GitHub。浏览器摄像头接口需要安全上下文和用户授权，参见 [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。
