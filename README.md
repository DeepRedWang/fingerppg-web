# FingerPPG 网页版

手机摄像头 → 红通道 primary 波形 → 心率估计，全部在浏览器本地处理。支持手机 IMU 三轴加速度/角速度、实际事件率与间隔统计、PPG + IMU 联合导出；保留默认摄像头锁定，不启用补光灯，不上传采集数据。

## 在 GitHub Pages 使用

1. 把本目录的全部文件放到一个 GitHub 仓库的根目录，保证 `index.html` 在根目录。
2. 打开仓库 **Settings → Pages**，在 Source 选择 **Deploy from a branch**。
3. 选择放置这些文件的分支（通常是 `main`）和 **/(root)**，保存。
4. 等待 Pages 页面显示站点地址。手机通过该 **HTTPS 地址**打开，点击“开始采集”并允许相机权限。

项目网址通常为 `https://你的用户名.github.io/仓库名/`。GitHub Pages 可以托管这些静态文件，并提供 HTTPS；GitHub Free 可用于公开仓库。参见 [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[发布目录设置](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)及 [HTTPS 说明](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)。

## 使用

- 先点击“体验 72 bpm 演示”检查曲线与读数；PPG 和 IMU 都是合成数据，不调用相机或运动传感器。
- IMU 默认勾选；点击“开始采集”后允许相机及运动权限。若拒绝、不支持或没有有效数据，IMU 区域给出提示，PPG 继续采集。不需要 IMU 时可在开始前取消勾选。
- 真正采集时轻覆正在使用的后置镜头，保持稳定的环境光。首次估计通常需要 8–10 秒。
- 手机固定使用默认后置摄像头，电脑使用系统默认摄像头；页面没有摄像头切换入口。首次成功开启后会在本机记住设备，停止、重新开始和刷新后继续使用同一摄像头；浏览器禁用本地存储时仅在当前页面内记住设备。
- 锁定设备不可用时停止并提示，不自动换到其他设备。如果清理相机权限后设备标识失效，需要清除此网站保存的数据后重新打开。画面太暗、手指判定无效或波形不稳定时心率留空。
- “下载数据”会先停止采集，再导出选择的 CSV 或 JSON。原始 RGB 文件记录每个实际送入算法的帧；主 CSV 记录 60 Hz 重采样后的波形与心率。
- 默认下载“完整会话 PPG + IMU JSON”，一次保存参数、波形、逐帧 RGB 和全部 IMU 事件；也可单独下载 IMU CSV。缺失轴导出为空值，真实的 0 会保留。
- 单次最多 5 分钟；切到后台停止相机和 IMU。IMU 最多保留 120,000 条事件，达到上限后停止 IMU 并提示，PPG 继续。当前会话只保存在页面内存中，重新开始、刷新或关闭前请下载需要的数据。
- 手机优先使用 Safari 或 Chrome；微信内置浏览器若无法采集，请在系统浏览器打开同一个 HTTPS 地址。

算法使用因果滤波、峰间隔中位数和频谱一致性检查，搜索范围 40–200 bpm。它尚未与参考心率作真机对照；60 Hz 是处理网格，不是对设备帧率的保证。时间戳为浏览器帧回调时刻，不是硬件曝光时间。

本程序无业务服务器、云函数或数据库。GitHub 仅托管网页文件，用户拍摄的视频不会发送给 GitHub。浏览器摄像头接口需要安全上下文和用户授权，参见 [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。

## IMU 与时间戳

通过 `DeviceMotionEvent` 读取浏览器提供的运动数据；权限申请直接由“开始”点击触发，参见 [MDN 权限说明](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static)。网页不能指定或保证硬件采样率；显示最近 5 秒包含任意有效轴的事件到达率、间隔均值/标准差/最大值，同时列出浏览器报告的 `interval`。不同轴可能缺失或具有不同更新率，不能把事件率当作所有轴的硬件采样率。

| 导出字段 | 含义 |
|---|---|
| `time_s` | 相对会话开始的秒数；实测 PPG 和 IMU 共用零点 |
| `callback_performance_ms` | 回调处理时读取的 `performance.now()`，毫秒 |
| `event_timestamp_ms` | 未转换的 IMU `Event.timeStamp`，毫秒；不假定为硬件采样时刻 |
| `reported_interval_ms` | 浏览器报告的 `DeviceMotionEvent.interval`，毫秒 |
| `ax/ay/az_m_s2` | 去重力加速度，m/s² |
| `gx/gy/gz_m_s2` | 含重力加速度，m/s²；这里的 g 前缀不代表陀螺仪 |
| `alpha/beta/gamma_deg_s` | 绕设备 Z/X/Y 轴的角速度，°/s |
| `has_sensor_value` | 本次事件是否含任意有限传感器值；全空事件也保留 |

完整 JSON 包含 `metadata`、`waveform`、`frames`、`imu` 四部分。参数中的 `session_origin_performance_ms` 给出公共零点，`performance_time_origin_unix_ms` 给出页面时钟原点。两路保留原始到达时间，不插值或强行逐行配对。演示使用合成的 30 Hz PPG 和 50 Hz IMU 时间，IMU 事件时间戳为空，不能用于评估设备抖动。

两幅 IMU 图显示最近 10 秒的原始数值，纵轴自动缩放；可以切换含重力和去重力加速度，导出始终保留两者。数据未进行应用层滤波、重采样或 SCG 心脏事件识别。按照 [W3C 运动事件规范](https://www.w3.org/TR/orientation-event/)，传感器数值可能为空且精度可能被降低；实际频率、噪声和延迟需要真机记录后评估。统一页面时钟不等于硬件同步，当前不输出 PTT 或血压。
