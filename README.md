# 小猫学习进度

一个本地保存数据的学习进度与计时工具，使用原生 HTML / CSS / JavaScript 和 Tauri 2，桌面版主要面向 Windows。

## 功能

- 课程树与课节完成状态、课节重点和学习要求。
- 课程学习与代码练习分别计时，支持暂停和继续。
- 学习足迹、按日汇总、最近七个自然日速度与结课预测。
- 陪伴猫、四边停靠、位置恢复和木鱼交互。
- 本地进度导入、导出与设置。

## 运行网页版

安装 Python 后，在项目根目录运行：

~~~powershell
python -m http.server 4173
~~~

打开 http://localhost:4173 。也可双击 start.bat。前端运行不依赖 npm 包。

## 测试

安装 Node.js，在项目根目录运行：

~~~powershell
npm test
~~~

测试使用内存中的模拟记录，不读取桌面软件的真实用户数据。

## 构建 Windows 桌面版

需要 Node.js、Rust stable（MSVC 工具链）、Microsoft C++ Build Tools、Windows SDK 和 WebView2。安装 Tauri CLI 2：

~~~powershell
cargo install tauri-cli --version "^2" --locked
~~~

在项目根目录双击 desktop-dev.bat 开发，或双击 desktop-build.bat 构建。也可执行：

~~~powershell
cd src-tauri
cargo tauri build
~~~

构建会重新下载 Cargo.lock 指定的依赖，生成 dist 和 src-tauri/target。安装包位于 src-tauri/target/release/bundle/nsis。

## 目录

- js、css、三个 HTML：页面、计时、统计与记录展示。
- assets：软件使用的插画和猫素材。
- data/courses.json：当前课程目录，708 节；阶段十 126 节、阶段十一 55 节。
- data/courses.raw.json：早期课程目录快照，用于标识兼容性测试。
- data/lesson-guide.json：课节重点与学习要求，不含个人笔记或进度。
- src-tauri：桌面窗口、托盘、猫位置与安装配置。
- scripts、tests：构建准备脚本和自动化测试。

## 本地数据与初始状态

桌面标识为 com.qaq.catstudy，产品名为“小猫学习进度”。课程进度、练习记录和个人课节备注分别保存在 localStorage 的 cat-study.progress.v1、cat-study.practice.v1、cat-study.lesson-notes.v1 中。猫的位置保存在应用本地配置中。浏览器版和桌面版的数据各自独立。

此仓库不包含作者的真实学习记录、用户数据库、登录资料、恢复聊天、旧规划或本机个人路径。公开目录只含课节标题和结构，不含课程视频、课件或机构账号，已移除机构内网网址。

这是现有个人工具的源码快照，保持原有初始化逻辑：首次启动从阶段五的预设位置开始，前 125 节为预设完成状态；这不是上传了作者的真实学习历史。仓库省略个人 data/progress.json，首次启动使用代码内的默认初始化。测试也验证该既有行为。

运行同标识的桌面程序会使用相同应用数据；已有用户请先使用软件的导出功能备份。程序不会把学习记录上传到 GitHub。

## 授权

本仓库公开供查看和学习，目前尚未选择开源许可证。公开可见不等于授予任意复制、修改或再发布的授权；代码和素材的使用需取得相应权利人的许可。
