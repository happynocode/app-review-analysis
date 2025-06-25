# Gemini API Integration Test

## 更改摘要

已成功将DeepSeek API替换为Google Gemini API，主要更改包括：

### 1. 函数名称更改
- `analyzeThemesWithDeepSeek` → `analyzeThemesWithGemini`
- `callDeepSeekAPI` → `callGeminiAPI`

### 2. 环境变量更改
- `DEEPSEEK_API_KEY` → `GEMINI_API_KEY`

### 3. API端点更改
- DeepSeek: `https://api.deepseek.com/chat/completions`
- Gemini: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}`

### 4. 多模型回退机制
新增了按优先级尝试多个Gemini模型的功能：
1. `gemini-2.5-flash`
2. `gemini-2.5-flash-lite-preview-06-17`
3. `gemini-2.5-flash-preview-tts`
4. `gemini-2.0-flash`
5. `gemini-2.0-flash-lite`

### 5. 请求格式更改
- DeepSeek使用OpenAI兼容格式
- Gemini使用Google特有的contents格式

### 6. 响应解析更改
- DeepSeek: `data.choices?.[0]?.message?.content`
- Gemini: `data.candidates?.[0]?.content?.parts?.[0]?.text`

## 测试要点

### 1. 环境变量配置
确保在Supabase项目中设置了 `GEMINI_API_KEY`

### 2. API调用测试
- 验证每个模型的API调用是否正确
- 测试模型回退机制是否工作
- 确认JSON解析逻辑正确

### 3. 错误处理测试
- 测试API密钥缺失的情况
- 测试所有模型都失败的情况
- 验证超时处理是否正确

### 4. 功能完整性测试
- 确认主题分析功能正常工作
- 验证批处理分析流程完整
- 测试不同平台的主题提取

## 部署注意事项

1. 需要在GitHub Secrets中添加 `GEMINI_API_KEY`
2. 可以移除 `DEEPSEEK_API_KEY` 相关配置
3. 确保Supabase Edge Functions环境变量已更新
