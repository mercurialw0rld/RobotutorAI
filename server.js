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

// In-memory storage for file annotations and conversation history
// In production, you might want to use Redis or a database
const sessionStorage = new Map();

// Helper function to get or create session
function getSession(sessionId) {
  if (!sessionStorage.has(sessionId)) {
    sessionStorage.set(sessionId, {
      fileAnnotations: null,
      conversationHistory: [],
      currentPDF: null
    });
  }
  return sessionStorage.get(sessionId);
}

// Helper function to clear session
function clearSession(sessionId) {
  sessionStorage.delete(sessionId);
}

// Learning levels configuration
const levels = {
    '1': `You have max 1000 tokens, adapt your response to that limitation. Speak in whatever language the user spoke you. Act as a very kind and patient teacher for small children. Explain the concept using very simple language, short sentences, and analogies that a child aged 5 to 8 can understand. Completely avoid technical or scientific terminology. Use examples involving playing, animals, or toys to make the explanation fun and clear.`,
    '2': `You have max 1000 tokens, adapt your response to that limitation. Speak in whatever language the user spoke you. You are a school tutor for students aged 12 to 15. Explain the concept of in a clear and direct way. Use language that is easy to understand, but you can introduce one or two keywords or technical terms and explain them simply within the context. Use practical examples or slightly more elaborate analogies.`,
    '3': `You have max 1000 tokens, adapt your response to that limitation. Speak in whatever language the user spoke you. You are a research assistant explaining concepts to a freshman university student. Explain the concept in a structured way and understandable for someone out of high school. Include the easiest formal definitions, fundamental principles, and the key steps of the process. Use appropriate terminology and provide a comprehensive overview of the topic. Explain the most basic concepts if needed.`,
    '4': `You have max 1000 tokens, adapt your response to that limitation. Speak in whatever language the user spoke you. You are an expert in the subject. Explain the concept to a colleague who is almost graduated and already has a solid understanding. Use intermediate technical terminology without needing to define it, if it is too advanced then define. Go directly to the details of the process, metabolic pathways, exceptions, molecular subunits, or advanced mechanisms. Do not include analogies or basic summaries.`,
    '5': `You have max 1000 tokens, adapt your response to that limitation. Speak in whatever language the user spoke you. You are a senior researcher. Explain the concept at a doctoral level. Do not explain the fundamentals of the topic; instead, delve into points of controversy, current challenges, new lines of research, advanced theoretical models, and the relevance of recent publications in the literature. Make reference to relevant theoretical models or equations.`
};

// API endpoint to clear PDF and annotations
app.post('/api/clear-pdf', (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    clearSession(sessionId);
    res.json({ success: true, message: 'PDF and conversation history cleared' });
  } catch (error) {
    console.error('Error clearing PDF:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint for chat completions
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt, level, documentPrompt, pdfData, fileName, sessionId } = req.body;

    console.log('Received request:', { 
      prompt: prompt?.substring(0, 50) + '...', 
      level, 
      documentPrompt,
      hasApiKey: !!OPENROUTER_API_KEY,
      sessionId: sessionId?.substring(0, 8) + '...'
    });

    if (!prompt || !level) {
      return res.status(400).json({ error: 'Prompt and level are required' });
    }

    if (!OPENROUTER_API_KEY) {
      console.error('OpenRouter API key not found in environment variables');
      return res.status(500).json({ error: 'OpenRouter API key not configured' });
    }

    // Get or create session
    const session = sessionId ? getSession(sessionId) : { fileAnnotations: null, conversationHistory: [], currentPDF: null };

    // Build messages array
    let messages = [
      {
        "role": "system",
        "content": levels[level]
      }
    ];

    // Add conversation history
    messages = messages.concat(session.conversationHistory);
    
    if (documentPrompt && pdfData) {
      // First time uploading PDF - store it and get annotations
      if (!session.fileAnnotations || session.currentPDF !== fileName) {
        messages.push({
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
        });
        session.currentPDF = fileName;
      } else {
        // Use existing annotations for follow-up questions
        messages.push({
          "role": "user",
          "content": prompt
        });
      }
    } else if (documentPrompt && session.fileAnnotations) {
      // Asking about document but no new PDF data - use annotations
      messages.push({
        "role": "user",
        "content": prompt
      });
    } else {
      // Regular chat without document
      messages.push({
        "role": "user",
        "content": prompt
      });
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

    // Get the referer URL from request or use environment variable
    const refererUrl = req.get('referer') || 
                      process.env.FRONTEND_URL || 
                      'https://robotutorai.onrender.com';

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': refererUrl,
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
      const assistantMessage = completion.choices[0].message;
      
      // Store file annotations if present (first time processing PDF)
      if (assistantMessage.annotations && sessionId) {
        session.fileAnnotations = assistantMessage.annotations;
        console.log('Stored file annotations for session:', sessionId.substring(0, 8) + '...');
      }
      
      // Update conversation history
      if (sessionId) {
        // Add user message to history
        session.conversationHistory.push({
          "role": "user",
          "content": prompt
        });
        
        // Add assistant response to history (with annotations if present)
        const historyMessage = {
          "role": "assistant",
          "content": assistantMessage.content
        };
        
        if (assistantMessage.annotations) {
          historyMessage.annotations = assistantMessage.annotations;
        }
        
        session.conversationHistory.push(historyMessage);
        
        // Keep only last 10 messages to prevent context from getting too large
        if (session.conversationHistory.length > 10) {
          session.conversationHistory = session.conversationHistory.slice(-10);
        }
      }
      
      res.json({
        success: true,
        response: assistantMessage.content,
        hasAnnotations: !!assistantMessage.annotations
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