# 🚀 FeedbackLens - AI-Powered App Review Analysis Platform

> Intelligent app review analysis platform that leverages AI technology to deeply analyze multi-platform user reviews and generate insightful reports quickly

## 📋 Project Overview

**FeedbackLens** is an AI-powered app review analysis platform that automatically scrapes and analyzes user reviews from multiple platforms (App Store, Google Play, Reddit). It utilizes advanced natural language processing technology to extract key insights and generate professional analysis reports.

### 🎯 Core Features

- **🔍 Multi-Platform Scraping**: Supports mainstream platforms like App Store, Google Play, Reddit
- **🧠 AI-Powered Analysis**: Uses OpenAI GPT models for deep review content analysis
- **📊 Real-time Monitoring**: Complete task monitoring and progress tracking
- **⚡ High-Performance Processing**: Parallel batch processing architecture for efficient handling of large datasets
- **📈 Visual Reports**: Beautiful report displays with PDF export functionality
- **🔐 User Authentication**: Secure authentication system based on Supabase

### 🏗️ Technical Architecture

**Frontend (React + TypeScript)**
- ⚛️ React 18 + TypeScript
- 🎨 Tailwind CSS + Framer Motion
- 🔄 React Query + Zustand
- 📱 Responsive Design

**Backend (Supabase)**
- 🗄️ PostgreSQL Database
- ⚡ Supabase Edge Functions (Deno)
- 🔐 Row Level Security (RLS)
- ⏰ Cron Job System

**AI & Data Processing**
- 🤖 Google Gemini API
- 📝 Intelligent Theme Extraction
- 🎯 Sentiment Analysis
- 📊 Data Visualization

## 🚀 Quick Start

### Requirements

- Node.js 18+
- npm or yarn
- Supabase CLI
- PostgreSQL 15+

### 1. Clone the Project

```bash
git clone https://github.com/happynocode/app-review-analysis.git
cd app-review-analysis
```

### 2. Install Frontend Dependencies

```bash
npm install
```

### 3. Environment Configuration

Create a `.env.local` file:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 4. Start Development Server

```bash
npm run dev
```

## 🛠️ Deployment Guide

### Frontend Deployment (GitHub Pages)

```bash
npm run build
npm run deploy
```

### Backend Deployment (Supabase)

```bash
# Initialize Supabase project
supabase init

# Start local development environment
supabase start

# Deploy database migrations
supabase db push

# Deploy Edge Functions
supabase functions deploy
```

## 📁 Project Structure

```
app-review-analysis/
├── 📂 src/                    # Frontend source code
│   ├── 📂 components/         # React components
│   │   ├── 📂 ui/            # Basic UI components
│   │   ├── AuthModal.tsx     # Authentication modal
│   │   ├── AppSelectionModal.tsx  # App selection modal
│   │   └── ...
│   ├── 📂 pages/             # Page components
│   │   ├── LandingPage.tsx   # Landing page
│   │   ├── DashboardPage.tsx # Dashboard
│   │   ├── ReportPage.tsx    # Report page
│   │   └── DemoPage.tsx      # Demo page
│   ├── 📂 stores/            # State management
│   │   ├── authStore.ts      # Authentication state
│   │   └── reportStore.ts    # Report state
│   ├── 📂 lib/               # Utility libraries
│   │   ├── supabase.ts       # Supabase client
│   │   └── database.ts       # Database operations
│   └── App.tsx               # Main app component
├── 📂 supabase/              # Backend code
│   ├── 📂 functions/         # Edge Functions
│   │   ├── start-analysis-v2/        # Start analysis
│   │   ├── process-analysis-batch-v2/ # Batch processing
│   │   ├── generate-report/          # Generate report
│   │   ├── complete-report-analysis/ # Complete analysis
│   │   ├── scrape-app-store/         # App Store scraper
│   │   ├── scrape-google-play/       # Google Play scraper
│   │   ├── scrape-reddit/            # Reddit scraper
│   │   ├── search-apps/              # App search
│   │   ├── start-scraping/           # Start scraping
│   │   ├── update-scraper-status/    # Update status
│   │   ├── cron-batch-processor/     # Scheduled batch processing
│   │   ├── cron-scraping-monitor/    # Scraping monitor
│   │   └── delete-all-data/          # Delete data
│   ├── 📂 migrations/        # Database migrations
│   │   ├── 20250100_complete_schema.sql
│   │   ├── 20250100_simplified_architecture.sql
│   │   └── cron_jobs.sql
│   └── config.toml          # Supabase configuration
├── 📂 public/               # Static assets
├── package.json            # Project configuration
├── tailwind.config.js      # Tailwind configuration
├── vite.config.ts          # Vite configuration
└── README.md              # Project documentation
```

## 🔧 Core Feature Modules

### 1. Review Scraping System

- **App Store**: Uses Apple Search API to scrape iOS app reviews
- **Google Play**: Web scraping to collect Android app reviews
- **Reddit**: Search for relevant discussions and user feedback

### 2. AI Analysis Engine

- **Smart Filtering**: Deduplication, time filtering, quality scoring
- **Theme Extraction**: Automatically identify key issues users care about
- **Sentiment Analysis**: Analyze user sentiment trends
- **Insight Generation**: Provide actionable improvement suggestions

### 3. Report Generation

- **Real-time Progress**: Analysis progress updates in real-time
- **Visual Display**: Charts and data visualization
- **PDF Export**: Professional report format export
- **Sharing Features**: Support for report link sharing

## 📊 Database Architecture

### Core Table Structure

- **users**: User information
- **reports**: Analysis reports
- **themes**: Analysis themes
- **quotes**: User review quotes
- **suggestions**: Improvement suggestions
- **scraping_sessions**: Scraping sessions
- **scraped_reviews**: Raw review data
- **analysis_tasks**: Analysis tasks
- **processing_queue**: Processing queue

## 🔐 Security Features

- **Row Level Security (RLS)**: Data access control
- **JWT Authentication**: Secure user authentication
- **API Rate Limiting**: Prevent abuse
- **Data Encryption**: Encrypted storage of sensitive data

## 📈 Performance Optimization

- **Parallel Processing**: Multi-batch parallel analysis
- **Smart Caching**: Reduce redundant computations
- **Database Optimization**: Index and query optimization
- **CDN Acceleration**: Static resource CDN distribution

## 🤝 Contributing Guide

1. Fork the project
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## 📝 Changelog

### v2.0.0 (2025-01)
- ✨ Refactored AI analysis engine
- ⚡ Performance optimization, 60-70% processing speed improvement
- 🔧 Enhanced monitoring system
- 📱 Optimized user interface

### v1.0.0 (2024-12)
- 🎉 Initial release
- 🔍 Multi-platform review scraping
- 🧠 AI-powered analysis
- 📊 Report generation system

## 📞 Support & Contact

- 🐛 Bug Reports: [GitHub Issues](https://github.com/happynocode/app-review-analysis/issues)

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
  <p>Made with ❤️ by FeedbackLens Team</p>
  <p>⭐ If this project helps you, please give us a star!</p>
</div>