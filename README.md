<img width="2560" height="1305" alt="ScreenShot_2026-03-25_211150_283" src="https://github.com/user-attachments/assets/3a68e9bb-e553-46da-a6ec-1161700a8c72" /><img width="2560" height="1305" alt="image" src="https://github.com/user-attachments/assets/40b22f37-fa87-4cfa-9907-5d69ab00645e" /># X-Sentinel

> 加密市场哨兵系统 — Powered by OKX Agent Trade Kit

<img width="2560" height="1305" alt="image" src="https://github.com/user-attachments/assets/3682a79c-21c7-46e8-83ce-49ccdbb0322b" />


## 简介

X-Sentinel 是一个基于 OKX Agent Trade Kit 构建的加密货币交易情报系统。通过自然语言对话，实时调用 OKX 83 个交易工具，提供行情分析、技术指标计算、市场情绪研判。

## 核心功能

### 📊 实时行情
- BTC、ETH、SOL、OKB 等主流币种实时价格
- 24h 涨跌幅、最高最低价、成交量
- 滚动横幅行情，点击直跳 OKX 现货交易页

### 📈 技术指标（自主计算）
- **RSI(14)**：超买超卖判断
- **MACD**：趋势方向与动能
- **布林带(20)**：价格波动区间
- **BTC 彩虹图**：长期估值区间

### 🚀 涨幅榜
- 24h TOP 10 涨幅币种实时排行
- AI 总结市场情绪与领涨分析

### 📰 加密新闻
- CoinDesk 实时 RSS 新闻
- 自动情绪标签：利好 / 利空 / 中性
- 点击直跳原文

### 💬 自然语言对话
- 支持中文提问：「BTC 现在可以买入吗？」
- 自动识别币种与查询意图
- 调用 OKX ATK 工具获取实时数据

## 技术架构

```
前端 (React + Vite + TailwindCSS)
    ↓ POST /api/chat
后端 (Node.js + Express)
    ↓ parseIntent()
意图解析 → runOKX(command)
    ↓
OKX Agent Trade Kit (83 tools)
    ↓
generateResponse() → 结构化回复
```

## 快速部署

### 前置要求
- Node.js >= 18
- OKX Agent Trade Kit (`okx` CLI)

### 安装

```bash
git clone https://github.com/wcq-glhf/x-sentinel.git
cd x-sentinel

# 后端
cd backend && npm install

# 前端
cd ../frontend && npm install && npm run build
```

### 启动

```bash
# 使用 PM2 守护进程
npm install -g pm2
pm2 start backend/server.js --name x-sentinel-backend
pm2 start npm --name x-sentinel-frontend -- run dev -- --host
pm2 save
```

或直接运行：

```bash
bash start.sh
```

### 访问

```
http://localhost:5174
```

## 环境变量

后端默认运行在 `3456` 端口，前端 `5174` 端口。

## 支持的查询示例

| 输入 | 功能 |
|------|------|
| `BTC现在多少钱` | 实时行情 |
| `ETH的RSI和MACD` | 技术指标 |
| `SOL趋势分析` | 综合研判 |
| `涨幅最大的前10个币` | 涨幅榜 |
| `BTC彩虹图` | 长期估值 |
| `你是谁` | 系统介绍 |

## 数据来源

- 行情数据：[OKX Agent Trade Kit](https://www.okx.com/web3/build/docs/devportal/agent-trade-kit-overview)
- 加密新闻：[CoinDesk RSS](https://feeds.feedburner.com/CoinDesk)

## License

MIT
