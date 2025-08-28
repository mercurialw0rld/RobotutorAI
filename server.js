// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Aumentamos el límite para PDFs
app.use(express.static('.')); // Servir archivos estáticos

// OpenRouter configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Learning levels configuration
const levels = {
    '1': `You have max 1000 tokens, adapt your response to that limitation. Speak in whatever language the user spoke you. Act as a very kind and patient teacher for small children. Explain the concept using very simple language, short sentences, and analogies that a child aged 5 to 8 can understand. Completely avoid technical or scientific terminology. Use examples involving playing, animals, or toys to make the explanation fun and clear.`,
    '2': `You have max 1000 tokens, adapt your response to that limitation. Speak in whatever language the user spoke you. You are a school tutor for students aged 12 to 15. Explain the concept of in a clear and direct way. Use language that is easy to understand, but you can introduce one or two keywords or technical terms and explain them simply within the context. Use practical examples or slightly more elaborate analogies.`,
    '3': `You have max 1000 tokens, adapt your response to that limitation. Speak in whatever language the user spoke you. You are a research assistant explaining concepts to a freshman university student. Explain the concept in a structured way and understandable for someone out of high school. Include the easiest formal definitions, fundamental principles, and the key steps of the process. Use appropriate terminology and provide a comprehensive overview of the topic. Explain the most basic concepts if needed.`,
    '4': `You have max 1000 tokens, adapt your response to that limitation. Speak in whatever language the user spoke you. You are an expert in the subject. Explain the concept to a colleague who is almost graduated and already has a solid understanding. Use intermediate technical terminology without needing to define it, if it is too advanced then define. Go directly to the details of the process, metabolic pathways, exceptions, molecular subunits, or advanced mechanisms. Do not include analogies or basic summaries.`,
    '5': `You have max 1000 tokens, adapt your response to that limitation. Speak in whatever language the user spoke you. You are a senior researcher. Explain the concept at a doctoral level. Do not explain the fundamentals of the topic; instead, delve into points of controversy, current challenges, new lines of research, advanced theoretical models, and the relevance of recent publications in the literature. Make reference to relevant theoretical models or equations.`
};

// API endpoint for chat completions
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt, level, documentPrompt, pdfData, fileName } = req.body;

    if (!prompt || !level) {
      return res.status(400).json({ error: 'Prompt and level are required' });
    }

    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'OpenRouter API key not configured' });
    }

    // Build messages array
    let messages;
    
    if (documentPrompt && pdfData) {
      messages = [
        {
          "role": "system",
          "content": levels[level]
        },
        {
          "role": "user",
          "content": [{
            "type": "text",
            "text": prompt
          },
          {
            "type": "file",
            "file": {
              "filename": fileName || "document.pdf",
              "file_data": pdfData
            }
          }]
        }
      ];
    } else {
      messages = [
        {
          "role": "system",
          "content": levels[level]
        },
        {
          "role": "user",
          "content": prompt
        }
      ];
    }

    // Call OpenRouter API
    const requestBody = {
      model: "google/gemini-flash-1.5",
      messages: messages,
      max_tokens: 1000,
      plugins: [
        {
          id: 'file-parser',
          pdf: {
            engine: 'pdf-text',
          },
        },
      ],
    };

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'RobotutorAI'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `OpenRouter API error: ${response.status}. ${errorText}` 
      });
    }

    const completion = await response.json();
    
    if (completion.choices && completion.choices[0] && completion.choices[0].message) {
      res.json({
        success: true,
        response: completion.choices[0].message.content
      });
    } else {
      res.status(500).json({ error: "Unexpected response format from OpenRouter API" });
    }

  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});