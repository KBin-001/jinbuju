# 进度页第三轮视觉 QA

## 对照基准

- source visual truth path: `C:/Users/24786/AppData/Local/Temp/codex-clipboard-accc7105-5a29-4e29-b5d1-677d6a528e97.png`
- implementation screenshot path: `D:/xwechat_files/Project/jinbuju/deliverables/progress-page-qa/final-round3-full-v2.png`
- viewport screenshot path: `D:/xwechat_files/Project/jinbuju/deliverables/progress-page-qa/final-round3-viewport-v2.png`
- route/state: `pages/plan/index`，真实账号数据，周视图，2026-07-23
- simulator: 微信开发者工具 iPhone 15 Pro Max，逻辑视口 `430 × 932`
- source pixels: `537 × 1159`
- implementation viewport pixels: `645 × 1398`
- implementation full-page pixels: `645 × 2164`
- density normalization: 参考图按宽度等比归一到 645px，与实现截图同宽对照；实现长图保留自然滚动高度，不压缩页面内容。

## 对照证据

- full-view comparison: `D:/xwechat_files/Project/jinbuju/deliverables/progress-page-qa/final-round3-comparison.png`
- focused chart comparison: `D:/xwechat_files/Project/jinbuju/deliverables/progress-page-qa/final-round3-chart-comparison.png`
- focused coach comparison: `D:/xwechat_files/Project/jinbuju/deliverables/progress-page-qa/final-round3-coach-comparison.png`

## 检查结果

**Findings**

- 未发现可执行的 P0/P1/P2 问题。
- 字体与层级：顶部标题使用宋体品牌字；目标、模块、正文和数字分别使用系统无衬线与等宽数字回退，400/500/600 字重层级清晰，未出现三位数挤压。
- 间距与版式：页面维持目标概览、三列指标、趋势、教练观察、成长记录的既定顺序；32rpx 页面边距、24rpx 模块节奏和统一暖白表面生效。实现因真实可读字号与自然滚动比参考图更长，属于明确的移动端可读性取舍，不是结构偏差。
- 色彩与令牌：奶油白、暖白、墨绿、低饱和金色和浅绿均统一到本轮令牌；边框和阴影保持低权重，没有玻璃拟态、重渐变或发光。
- 图像质量：顶部山水和目标山水图继续使用现有正式位图资源，透明度、裁切与圆形蒙版清晰，无 CSS/临时 SVG 替代。
- 图表：真实数据 `60 / 240 / 15 / 0` 正常呈现；动态分钟刻度为 `0 / 60 / 120 / 180 / 240`；未来 07.24—07.26 只保留低饱和日期，不绘制折线、面积、节点，也不参与平均值。平均标签已移至未来留白区，未与主曲线重叠。
- 文案与内容：目标、累计指标、摘要和教练结论均来自当前真实数据；参考图与实现数字差异属于用户数据差异。
- 教练观察：环形评分、核心结论、证据条、下一步建议和完整分析入口层级清晰，触控入口保留。
- 底部导航：选中墨绿、未选灰绿、金色短线和安全区均正常；长截图中成长记录完整可见，未被 TabBar 遮挡。

**Open Questions**

- 无阻塞问题。

**Implementation Checklist**

- [x] 统一字体、数字、色彩、圆角、边框、阴影和间距令牌
- [x] 精修目标概览与三列指标的比例、对齐和长数字适配
- [x] 截断未来日期系列并排除未来日期平均值
- [x] 修正图表标签、平均线、当前日期与极差数据可读性
- [x] 精修教练观察、成长记录和 TabBar
- [x] 微信开发者工具真实编译、运行截图和日志检查

## Comparison History

1. 第一次实现对照发现 P2：未来日期被按 0 连到基线，平均值标签与金色系列距离过近。
   - 修复：在周/月桶和图表点中加入 `isFuture` 派生状态；曲线、面积、节点、平均值和点击态全部过滤未来日期；平均标签移至当前日期右侧的空白区域。
   - 修复后证据：`final-round3-viewport-v2.png`、`final-round3-chart-comparison.png`。
2. 修复后第二次对照：未来日期仅保留弱化坐标，主/次系列均在今天结束；标签无明显重叠，未发现新的 P0/P1/P2。

## 运行与交互验证

- TypeScript：`npm exec tsc -- --noEmit` 通过。
- 进度页契约：`node test/progress-coach-card.test.js` 通过。
- 微信开发者工具编译：0 error、0 warning。
- CDP 运行日志：8 秒采集，0 error、0 warning。
- 周视图运行数据已核对；月视图运行数据已核对，未来第 5 周标记为未发生。
- 周/月/年切换、目标切换、历史记录和完整分析继续使用原事件及路由；本轮未改动其业务链路。

final result: passed

---

# AI 成长教练「今日复盘」参考图复刻视觉 QA

## 对照基准

- source visual truth path: `C:/Users/24786/AppData/Local/Temp/codex-clipboard-0c082ca9-4585-41f4-8bcc-86f922e91d59.png`
- implementation screenshot path: `D:/xwechat_files/Project/jinbuju/deliverables/ai-coach-page-qa/final-typical-data.png`
- real-data screenshot path: `D:/xwechat_files/Project/jinbuju/deliverables/ai-coach-page-qa/final-real-data.png`
- route/state: `pages/ai-coach/index?scope=day`，今日复盘；完成态截图通过开发者工具临时 `setData` 仅做排版验收，没有写入缓存、数据库或云端
- simulator: 微信开发者工具 iPhone 12/13 (Pro)，逻辑视口 `390 × 844`，系统 DPR `3`
- source pixels: `942 × 1676`
- implementation pixels: `486 × 1052`（IDE 83% 画布裁切）
- density normalization: 参考图按实现截图高度等比缩放后与实现并排；仅比较应用内容，不把参考图中的静态系统时间作为业务 UI 复刻。

## 对照证据

- full-view comparison: `D:/xwechat_files/Project/jinbuju/deliverables/ai-coach-page-qa/final-comparison.png`
- focused diagnosis and composer comparison: `D:/xwechat_files/Project/jinbuju/deliverables/ai-coach-page-qa/final-focused-diagnosis.png`

## 检查结果

**Findings**

- 未发现可执行的 P0/P1/P2 问题。
- 字体与层级：品牌标题、复盘结论和模块标题保持东方衬线气质；正文、按钮和说明使用清晰系统字体。结论限制两行并保留参考图式省略，不挤压山水主视觉。
- 间距与布局：头部、三列数据、今日建议、四项闭环诊断、今日行动回顾和吸底输入区顺序与比例均对齐参考图；四个诊断单元在 390px 视口保持同高且无横向溢出。
- 色彩与表面：奶油白、米杏、墨绿和克制金色保持项目原主题；卡片采用轻边框、极弱阴影和低透明山水纹理，没有玻璃拟态、强发光或大面积装饰渐变。
- 图像质量：顶部和卡片纹理继续复用项目正式山水位图与正式教练品牌标识，没有用 CSS 山峰、临时 SVG 或 Emoji 替代。
- 数据真实性：综合评分、等级、节奏、质量、专注时段和下一步建议均由当前范围内的完成率、实际投入、连续天数与真实完成时段派生；空数据明确显示待建立，不伪造 92 分或上午时段。
- 输入区：保留原发送事件与 1000 字限制，升级为墨绿色圆形向上箭头、克制金色细节、明确占位语和安全区吸附；禁用态仍保持品牌形态但不可提交。
- 周/月/长期兼容：仅“今日复盘”使用闭环诊断；其他范围继续保留原真实节奏分布，范围切换、目标数据、历史对话和行动编辑入口均未删除。
- 文案与内容：今日建议三个提问、行动回顾入口和空状态沿用真实页面语义；没有增加无行为按钮或概念性模块。

**Open Questions**

- 无阻塞问题。

## Comparison History

1. 首次运行对照发现 P2：吸底发送按钮禁用态变成普通灰色圆点，弱于参考图的品牌主操作；四项诊断卡在长文案下略显拥挤。
   - 修复：禁用态保留低饱和墨绿色，使用正式 TDesign 向上箭头并加入金色状态点；诊断内容限制两行，补充小屏字号与间距规则。
   - 修复前证据：`after-01.png`。
2. 典型完成态对照发现 P2：三位数以上投入可能压缩三等分布局，今日行动回顾说明与参考图语义略有偏差。
   - 修复：按数值长度派生紧凑字号；今日范围说明改为“优先展示仍需要复盘输出的行动”，周/月范围保持原说明。
   - 修复后证据：`final-comparison.png`、`final-focused-diagnosis.png`。
3. 修复后再次并排检查字体、间距、色彩、图像、文案和安全区，未发现新的 P0/P1/P2。

## 运行与交互验证

- TypeScript：在 `miniprogram` 目录执行 `npm exec tsc -- --noEmit`，通过。
- 根级契约测试：`node --test test/*.test.js`，35/35 通过。
- 小程序全部测试：`miniprogram/tests/*.test.js` 全部通过。
- 微信开发者工具编译：0 error、0 warning，WXML 0 error。
- CDP 运行日志：8 秒采集，0 error、0 warning。
- 今日与本周范围已在模拟器调用真实切换方法验证；本周仍展示真实 `315` 分钟、`4/13` 行动及原节奏模块。
- 空数据、典型完成态、三位数投入、长诊断文案、吸底安全区和滚动后的行动回顾均完成视觉检查。

final result: passed

---

# 今日页智能执行方式改版视觉 QA

## 对照基准

- source visual truth path: `C:/Users/24786/.codex/generated_images/019f6b7c-c5f0-7b00-bc95-2230eb404ee1/call_sPIaiHHZEf1gnPAfkis8N7f3.png`
- implementation screenshot path: `D:/xwechat_files/Project/jinbuju/.codex/today-smart-actions-final.png`
- full-view comparison: `D:/xwechat_files/Project/jinbuju/.codex/today-smart-actions-compare-final.png`
- route/state: `pages/index/index`，真实账号多任务数据，未计时状态
- capture: 微信开发者工具模拟器，通过 CDP 裁切设备视口

## 检查结果

**Findings**

- 未发现可执行的 P0/P1/P2 视觉问题。
- 参考方案的通透问候、轻周历、“今日行动 + 按习惯推荐”、执行偏好入口、统一任务列表、轻量目标进度和 AI 建议均已落到真实页面结构。
- 每个任务仅保留一个主操作，并根据任务和会话状态显示“完成 / 开始专注 / 继续专注 / 专注中 / 查看结果”。
- “开始专注”使用浅玉绿色渐层、全圆角胶囊、极轻边框与阴影；未出现方形按钮、巨大倒计时或厚重操作区。
- 任务更多菜单保留直接完成、专注计时、部分完成、执行方式、顺延、跳过、编辑和删除，主列表不堆叠多个大按钮。
- 新增行动可选择“直接完成 / 专注计时 / 每次询问”；旧任务缺省采用短任务优先完成、长任务优先专注的低风险推荐。
- 真实长标题在当前小屏视口下使用省略，按钮和更多菜单未被挤出；顺延标记、实际投入和计时状态继续可读。
- 进度模块恢复为参考图中的轻薄卡片，并继续读取真实目标分钟、实际投入与百分比。

**Open Questions**

- 无视觉阻塞项。主包当前约 `2,064,760 bytes`，距离 2MB 限制余量约 32KB，后续新增主包资源应优先压缩或迁入分包。
- `executionMode` 已加入云同步数据契约；正式使用跨设备同步前需重新部署 `generatePlan` 云函数。

## Comparison History

1. 首次并排对照发现 P2：初版仅展示 3 个任务，进度条缺少参考方案的轻卡片承载。
   - 修复：默认列表增加到 4 项；进度模块加入 26rpx 圆角、暖白表面、低权重边框与阴影。
2. 修复后重新编译并截取真实视口，任务比例、圆润操作按钮、模块节奏与参考图收敛，未发现新的 P0/P1/P2。

## 运行与交互验证

- TypeScript：`npx tsc --noEmit`，通过。
- 今日页与图标合同测试：2/2 通过。
- 微信开发者工具编译：0 error、0 warning；WXML 0 error。
- “执行偏好”入口已在模拟器点击验证，三种真实选择正常弹出。
- 主操作、更多菜单、开始/暂停/继续/结束计时继续绑定现有业务方法；本轮视觉验收未启动真实计时，避免污染用户数据。

final result: passed

---

# 今日页商业化计时改版视觉 QA

## 对照基准

- source visual truth path: `C:/Users/24786/AppData/Local/Temp/codex-clipboard-5edee28c-297b-4010-8851-c2f35cddc1e6.png`
- implementation idle screenshot path: `D:/xwechat_files/Project/jinbuju/.codex/today-commercial-ui-final.png`
- implementation running screenshot path: `D:/xwechat_files/Project/jinbuju/.codex/today-commercial-ui-running-final.png`
- route/state: `pages/index/index`，真实账号数据，2026-07-23，计时中状态
- capture: 微信开发者工具模拟器，通过 CDP 裁切设备视口
- source pixels: `852 × 1846`
- implementation pixels: `485 × 1049`
- density normalization: 参考图按实现截图宽高归一，仅用于比较信息层级、比例和视觉节奏；任务名称、任务数量、投入分钟与连续天数继续使用真实账号数据。

## 对照证据

- full-view comparison: `D:/xwechat_files/Project/jinbuju/.codex/today-design-compare-final.png`
- idle state: `D:/xwechat_files/Project/jinbuju/.codex/today-commercial-ui-final.png`
- running state: `D:/xwechat_files/Project/jinbuju/.codex/today-commercial-ui-running-final.png`

## 检查结果

**Findings**

- 未发现可执行的 P0/P1/P2 视觉问题。
- 信息架构已与参考图对齐：通透问候、轻量周历、单张行动列表、细进度条、轻量 AI 建议和按需出现的悬浮计时条。
- 页面继续使用奶油白、米杏、墨绿和克制金色；山水只用于顶部氛围，未遮挡标题与正文。
- 多个任务合并在一张列表卡内，真实多任务场景保持分割线、图标、时间和操作状态对齐；顺延任务保留独立标记。
- 未计时任务显示明确“开始计时”；计时任务行显示“进行中 · N分钟”，不再用厚重主卡或巨大秒表抢占首页。
- 悬浮计时条在窄屏实机视口中完整显示任务名、已用时间、线性进度、暂停/继续和结束计时，且位于 TabBar 上方。
- 今日目标分钟、已投入分钟和比例均来自真实行动数据；空投入不再显示 `0/0`。
- AI 建议使用当前真实任务和投入分钟生成一句下一步，加载或云端失败时沿用本地建议并如实标注。
- 参考图与实现的任务数量、任务名称和数值差异均来自真实数据，不使用静态示例覆盖业务数据。

**Open Questions**

- 无阻塞项。主包当前约 `2,056,813 bytes`，仍低于 `2,097,152 bytes` 限制，但余量约 40KB，后续继续新增主包资源前应优先迁移或压缩。

## Comparison History

1. 首轮实现对照发现 P2：原生 `button` 默认宽度使任务“开始计时”按钮偏宽。
   - 修复：为任务操作设置明确宽度、最小宽度和 `box-sizing`，重新截图确认比例收敛。
2. 计时中窄屏对照发现 P2：原生按钮最小宽度挤压任务名，并让“结束计时”落到可视区之外。
   - 修复：计时控制改为带 `role="button"`、无障碍标签和按压态的轻量交互视图；固定身份、时钟、进度和操作的宽度，最终截图中五类信息全部可见。
3. 修复后再次与 source 并排检查，未发现新的 P0/P1/P2。

## 运行与交互验证

- TypeScript：在 `miniprogram` 目录执行 `npm exec tsc -- --noEmit`，通过。
- 完整合同测试：`node --test test/*.test.js`，35/35 通过。
- 服务测试：`node miniprogram/tests/manual-services.test.js`，通过。
- 图标补丁：`npm run patch:icons`，通过。
- 微信开发者工具编译：0 error、0 warning；WXML 0 error。
- 微信开发者工具运行：最终跳转日志 0 error、0 warning；另一次 `Page.onShow` 性能提示为 52ms，不构成功能或视觉阻塞。
- 开始计时和暂停已在真实运行态点击验证；暂停后页面数据为 `paused`。
- 继续、仅结束计时、同时标记完成、投入累计和幂等保护由服务测试覆盖；结束计时与完成行动保持独立。
- QA 临时计时会话已清理，任务仍为未完成且实际投入为 0，未污染真实业务数据。

final result: passed
