# 🔬 病理学识图复习 — Patho Pic Reviewer

人体概论实验课 · 病理图片考试题库复习工具。

## 一键使用（推荐⭐）

无需安装任何环境，下载单个文件直接打开即可使用：

1. 下载仓库中的 **`病理识图复习_完整版.html`**
2. 双击用浏览器打开
3. 开始复习

> 108 张图片已全部内嵌，文件约 34MB，首次加载需几秒。支持 Chrome / Edge / Safari。

---

## 开发者使用

如需修改代码、自定义题库，可克隆完整仓库：

### 1. 克隆仓库

```bash
git clone https://github.com/Oceannn233/patho-pic-reviewer.git
cd patho-pic-reviewer
```

### 2. 启动

```bash
python3 -m http.server 8765
```

浏览器打开 `http://localhost:8765`

> 也可用 VS Code Live Server，或直接双击 `index.html`（可能有跨域限制）。

---

## 两个版本说明

| 文件 | 说明 | 适用 |
|------|------|------|
| `病理识图复习_完整版.html` | 图片全部内嵌，单文件独立运行 | **普通用户，一键使用** |
| `index.html` + `images/` + `js/` | 分离式结构，图片从本地加载 | 开发者，需修改代码时 |

## 题库

| 分类 | 题数 |
|------|------|
| 血循障碍 | 19 |
| 炎症 | 22 |
| 肿瘤 | 49 |
| 组损与修复 | 18 |

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Enter | 确认输入 |
| Ctrl+Enter | 提交答案 |
| N | 下一题 |
| Esc | 关闭弹窗/缩放 |

## 项目结构

```
patho-pic-reviewer/
├── index.html              # 主页面
├── css/
│   └── style.css           # 样式表
├── js/
│   ├── app.js              # 应用逻辑
│   └── knowledge.js        # 知识点库（提示+解析）
├── data/
│   └── question_bank_light.json  # 题库数据
└── images/                 # 109张病理图片
```
