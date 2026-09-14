# FingerPPG 网页版

手机摄像头 → 红通道 primary 波形 → 心率与 30 秒 HRV 估计，全部在浏览器本地处理。HRV 每 5 秒更新，在心率卡片中小字号显示。IMU 只记录三轴加速度（含重力）；优先选择独立后置镜头，不启用补光灯，不上传采集数据。页面底部版本标记：30 s HRV v5。

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
- 手机开始后自动固定采集画面，两路波形、心率和停止按钮同屏显示；保留小相机预览。可点击「展开页面」继续采集并浏览完整页面，停止后恢复原页面和滚动位置。固定画面阻止页面滑动，减少 Safari 滚动时运动事件暂缓的触发机会；不能保证系统不再中断派发。桌面可手动进入固定画面。
- 手机在取得相机权限后枚举镜头，优先选取名称可识别的独立后置主摄，排除双摄/三摄等组合相机；随后通过精确设备编号固定。iPhone 无法确认独立镜头时停止并列出可见名称，不凭设备顺序猜测。电脑使用系统默认摄像头。开始测量后无切换入口，停止/刷新后复用已选设备。
- 升级时忽略旧版保存的组合相机编号，重新选择一次。选择过程可能短暂打开默认相机以取得设备列表，只有最终镜头就绪后才开始记时。请等待镜头名称确定后覆盖镜头。浏览器禁用本地存储时仅在当前页面内记住设备。
- 默认仍请求 60 Hz，可在开始前选 30 Hz 减轻负载；支持时施加精确帧率约束，实际到帧率仍以回调记录为准。只读出原尺寸中央 ROI，不缩小像素；RGB 均值与 primary/心率计算优先放在 Worker。最多 3 帧待处理，超出后跳过并记录。绘图每秒 10 次，屏幕外暂停重绘，采集继续。
- 锁定设备不可用时停止并提示，不自动换到其他设备。如果清理相机权限后设备标识失效，需要清除此网站保存的数据后重新打开。画面太暗、手指判定无效或波形不稳定时心率留空。
- “下载数据”会先停止采集，再导出选择的 CSV 或 JSON。原始 RGB 文件记录每个实际送入算法的帧；主 CSV 记录 60 Hz 重采样后的波形与心率。
- 默认下载“完整会话 PPG + IMU + HRV JSON”，一次保存参数、波形、逐帧 RGB、全部 IMU 事件和 HRV 结果；也可单独下载 IMU 或 HRV CSV。缺失轴导出为空值，真实的 0 会保留。
- 单次最多 5 分钟；切到后台停止相机和 IMU。IMU 最多保留 120,000 条事件，达到上限后停止 IMU 并提示，PPG 继续。当前会话只保存在页面内存中，重新开始、刷新或关闭前请下载需要的数据。
- 相机短暂 `mute`、缺帧或结束不会把加速度一起停止；暂时缺帧等待同一镜头恢复，不自动换镜头。相机缺帧超过 15 秒且加速度未启用时停止会话。加速度连续没有事件时保留监听，间隔至少 10 秒尝试重新挂接，连续最多 3 次；不重复弹授权、不合成缺失样本。
- 手机优先使用 Safari 或 Chrome；微信内置浏览器若无法采集，请在系统浏览器打开同一个 HTTPS 地址。

算法使用因果滤波、峰间隔中位数和频谱一致性检查，搜索范围 40–200 bpm。它尚未与参考心率作真机对照；60 Hz 是处理网格，不是对设备帧率的保证。时间戳为浏览器帧回调时刻，不是硬件曝光时间。

本程序无业务服务器、云函数或数据库。GitHub 仅托管网页文件，用户拍摄的视频不会发送给 GitHub。浏览器摄像头接口需要安全上下文和用户授权，参见 [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。

## 30 秒 HRV

心率卡片内小字号显示 SDRR（ms）、RMSSD（ms）、pNN50（%）、LF/HF。统计最近连续 30 秒有效 primary 波形，每 5 秒更新；3 秒滤波初始化后开始累计，首次通常约 33 秒。原 primary 波形和心率算法未改。HRV 与图像/心率计算同在 Worker 中，只有 Worker 不可用时才回退到主线程。停止后保留最后结果并标注已停止，重新开始会清空。

这些指标实际由 PPG 脉搏峰间期计算，属于脉搏间期变异性（PRV），不是 ECG 测得的 RR/NN；不进行正常心搏或异位搏动分类。PPG 和 ECG 指标的一致性取决于条件，不能直接视为等同，参见 [手机 PPG 与 ECG 对照研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC4309304/)。

令完整脉搏间期为 I（单位 ms）、数量为 N：SDRR 使用样本标准差（分母 N−1）；RMSSD 为相邻间期差平方的均值再开根号（N−1 对差）；pNN50 为相邻差绝对值严格大于 50 ms 的比例（分母 N−1），乘 100%。峰检测沿用 primary 的局部极大值、最短间距和突出度规则，对峰顶做抛物线细化；细化不代表提高相机的硬件时间精度。

LF/HF 是 **30 秒频域粗估**，不能替代标准 5 分钟测量；超短窗口的可靠性随指标与测量条件而变，参见 [30–300 秒对照研究](https://pubmed.ncbi.nlm.nih.gov/33856258/)。仅在完整有效窗口内，以每个间期的中点为时间，线性插值至 4 Hz（不外推），去线性趋势，用周期 Hann 窗功率谱和梯形积分求 LF（0.04–0.15 Hz）、HF（0.15–0.40 Hz）及比值。512 点频率网格只用于积分，不会提高实际时间窗口的分辨率。去趋势后间期方差小于 1 ms² 或 HF 不足时不显示比值；不作交感/副交感解释。

应用质量门限：至少 15 个完整间期、覆盖至少 26 秒；窗口末端的心率质量检查通过；原始到帧间隔第 90 百分位不超过 40 ms，最大不超过 100 ms。任何间期不在 300–1500 ms 或偏离附近最多 5 个间期中位数超过 20%，整个窗口标为异常并留空；不会删除异常间期后跨缺口计算相邻差，也不合成心搏。这些是保守的软件门限，可能使真实但变化较大的间期也被判为不可靠，尚未经手机真机 HRV 验证。

完整 JSON 新增 `hrv` 数组，每次计算保存时间、状态、窗口长度、间期数、SDRR/RMSSD/pNN50、LF/HF 和两频带功率、峰时间 `pulse_times_s` 与 `ppi_ms`，可复核计算；不足或异常项为 null。`metadata.hrv` 记录方法和质量门限，`metadata.hrv_latest` 保存最后一次结果。独立「30 s HRV 指标 CSV」保存每次标量结果及状态。初始化/断流会立即输出状态变化，其余更新间隔为 5 秒。固定 72 bpm 演示应得到近零的时域指标，LF/HF 因波动不足留空，不用演示数据评价真机准确度。

## IMU 与时间戳

通过 `DeviceMotionEvent.accelerationIncludingGravity` 只读取 X/Y/Z 加速度；不读取、存储或显示角速度以及去重力融合数据。权限接口仍可能显示「运动与方向」，底层传感器启用方式由浏览器决定，网页不能保证系统只启动加速度计。权限申请直接由“开始”点击触发，参见 [MDN 权限说明](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static)。显示最近 5 秒包含任意有效轴的实际事件率、间隔均值/标准差/最大值，同时列出浏览器报告的 `interval`，不将其当作实际采样率。

| 导出字段 | 含义 |
|---|---|
| `time_s` | 相对会话开始的秒数；实测 PPG 和 IMU 共用零点 |
| `callback_performance_ms` | 回调处理时读取的 `performance.now()`，毫秒 |
| `event_timestamp_ms` | 未转换的 IMU `Event.timeStamp`，毫秒；不假定为硬件采样时刻 |
| `reported_interval_ms` | 浏览器报告的 `DeviceMotionEvent.interval`，毫秒 |
| `callback_interval_ms` | 与上一条事件的回调时间差，毫秒；首条为空 |
| `event_interval_ms` | 与上一条浏览器事件时间戳的差，毫秒；任一时间戳缺失则为空，不转换成硬件采样间隔 |
| `accel_x_m_s2` / `accel_y_m_s2` / `accel_z_m_s2` | 三轴含重力加速度，m/s²；来源见 `metadata.imu.source` |
| `has_sensor_value` | 本次事件是否含任意有限传感器值；全空事件也保留 |

完整 JSON 包含 `metadata`、`waveform`、`frames`、`camera_events`、`imu`、`hrv`。`camera_events` 记录每个新帧回调（包括队列满时跳过处理的帧），用于区分相机到帧与应用处理丢帧；参数保留实际镜头名称、设置、相机中断事件、加速度超过 100 ms 的缺口和重挂监听次数。`gaps_over_250ms` 仍保留以兼容 v3。`metadata.page_interactions` 记录进入/退出固定画面、滚动（最多每 100 ms 一条）和画布尺寸变化，最多 3,000 条；窗口尺寸变化但画布尺寸不变时不重复清空画布。`session_origin_performance_ms` 给出公共零点，`performance_time_origin_unix_ms` 给出页面时钟原点。两路保留原始到达时间，不插值或强行逐行配对。演示使用合成的 30 Hz PPG 和 50 Hz 加速度时间，IMU 事件时间戳为空，不能用于评估设备抖动。

诊断行分别显示距上次数据的时间、超过 100 ms 的回调缺口数、包含缺失轴的事件数。某轴为空或相邻记录相差超过 100 ms 时断开该轴曲线。缺口计数在恢复收到下一条事件时增加；仍未恢复时看距上次数据的时间。全空事件也计入缺轴事件。

网页版已经通过浏览器读取手机内置传感器，无需安装 App；但不能控制底层采样队列。WebKit 当前源码将 iOS 运动更新间隔设为 `1.0f / 60.0f`，见 [WebCoreMotionManager.h](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/ios/WebCoreMotionManager.h)。`DeviceMotionEvent` 只暴露给 Window，不能移到 Web Worker 直接订阅；Worker 仅承担收到数据后的计算，参见 [W3C 接口定义](https://www.w3.org/TR/orientation-event/#devicemotionevent)。本页不承诺稳定 100 Hz，也不将插值或定时器调用数当作新样本。固定画面及缺口诊断已在桌面浏览器和模拟事件中验证，iPhone 17 Safari 的实际改善程度需要真机记录确认。

三轴图各自显示最近 10 秒的原始数值，各轴独立缩放，避免重力偏置掩盖其他轴的变化。没有滤波、补点或 SCG 心脏事件识别。按照 [W3C 运动事件规范](https://www.w3.org/TR/orientation-event/)，传感器数值可能为空且精度可能被降低；实际频率、噪声和延迟需要真机记录后评估。统一页面时钟不等于硬件同步，当前不输出 PTT 或血压。

相机设备编号可能指向组合镜头，相关 WebKit 讨论见 [独立相机与组合相机](https://bugs.webkit.org/show_bug.cgi?id=253186)。当前选择依赖浏览器公开的镜头名称，不能从标准 API 独立证明物理镜头类型；支持常见英文和中文名称，iPhone 17 的最终效果需真机确认。`mute` 代表轨道暂时无法提供数据，参见 [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/mute_event)。
