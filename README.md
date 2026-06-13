# PulseBI - Real-Time Business Intelligence & Analytics Platform

PulseBI is an end-to-end Real-Time Business Intelligence (BI) and Analytics Platform designed to collect, process, analyze, and visualize live business data streams. The system processes incoming live transactions or operational data, runs predictive machine learning models for forecasting, and pushes instant updates to a dynamic dashboard using WebSockets—completely eliminating the need for page refreshes.

---

## Key Features

- **Live Data Streaming & Ingestion:** Scalable pipeline capable of handling continuous high-velocity business data streams.
- **Real-Time Stream Processing:** Instant data cleaning, aggregation, and key metric computation as events occur.
- **Predictive Analytics (ML):** Integrated time-series forecasting models to predict future trends and detect operational anomalies.
- **Interactive Live Dashboard:** A modern, dynamic UI featuring auto-updating charts, live KPI cards, and instant system alerts.
- **Strategic Decision Support:** Comprehensive view of live business health to aid immediate executive decision-making.

---

## Tech Stack (Proposed)

- **Frontend:** React.js, Tailwind CSS, Recharts / Chart.js, Socket.io-client
- **Backend & APIs:** Python (FastAPI / Flask) OR Node.js (Express)
- **Data Streaming:** Apache Kafka / RabbitMQ / Python Custom Stream Simulator
- **Stream Processing:** Apache Spark / Pandas Stream Processor
- **Machine Learning:** Python (Scikit-Learn, XGBoost, LSTM)
- **Database:** MongoDB Atlas (NoSQL) OR PostgreSQL (Relational)

---

## Repository Structure & Module Allocation

The project is structured into clear modules to allow parallel development across 5 sub-teams (couples):

```text
pulse-bi-platform/
├── backend/                  # Ingestion, Engine, ML, and API Layer
│   ├── data_stream/          # [Couple 01 & 02] Data generation & Kafka pipelines
│   ├── analytics_ml/         # [Couple 03] KPI calculation & Machine Learning forecasting
│   └── api_server/           # [Couple 04] REST APIs & WebSockets Server
└── frontend/                 # [Couple 05] Complete Live UI & BI Dashboard
```

---

## Getting Started

### Prerequisites

- **Python 3.9+**
- **Apache Kafka** running locally on `localhost:9092`
- **MongoDB** running locally on `localhost:27017`

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/stream-bi-analytics.git
cd stream-bi-analytics
```

### 2. Create a Virtual Environment

```bash
cd backend
python -m venv venv
```

Activate the virtual environment:

- **Windows (PowerShell):**
  ```bash
  .\venv\Scripts\Activate.ps1
  ```
- **Windows (CMD):**
  ```bash
  venv\Scripts\activate.bat
  ```
- **macOS / Linux:**
  ```bash
  source venv/bin/activate
  ```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure Environment Variables (Optional)

```bash
cp .env.example .env
# Edit .env with your MongoDB URI, Kafka broker address, etc.
```

### 5. Run the Pipeline

Open **two separate terminals** (make sure the venv is activated in both):

**Terminal 1 — Start the Kafka Producer:**
```bash
cd backend
python kafka_producer.py
```

**Terminal 2 — Start the Kafka Consumer:**
```bash
cd backend
python kafka_consumer.py
```

### 6. Verify in MongoDB

Open **MongoDB Compass** and connect to `mongodb://localhost:27017`. Navigate to the `stream_analytics` database and verify that the following collections are continuously growing with live data:

| Collection | Description |
|---|---|
| `transactions` | Raw, cleaned streaming events |
| `hourly_metrics` | Aggregated summary data per hour |
| `daily_metrics` | Aggregated summary data per day |
