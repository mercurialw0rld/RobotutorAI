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
// Each session stores up to 20 messages (10 exchanges) for conversation context
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
  if (sessionStorage.has(sessionId)) {
    console.log(`Clearing session ${sessionId.substring(0, 8)}... - had ${sessionStorage.get(sessionId).conversationHistory.length} messages`);
    sessionStorage.delete(sessionId);
    console.log(`Session ${sessionId.substring(0, 8)} cleared successfully`);
  } else {
    console.log(`Session ${sessionId.substring(0, 8)} not found for clearing`);
  }
}

// Learning levels configuration
const levels = {
    '1': `You have max 2000 tokens, adapt your response to that limitation. CRITICAL: Speak in whatever language the user spoke you in the first message. IMPORTANT: You have access to the conversation history. Use previous context to maintain coherence, remember user preferences, and build upon previous explanations. Act as a very kind and patient teacher for small children. Explain the concept using very simple language, short sentences, and analogies that a child aged 5 to 8 can understand. Completely avoid technical or scientific terminology. Use examples involving playing, animals, or toys to make the explanation fun and clear.`,
    '2': `You have max 2000 tokens, adapt your response to that limitation. CRITICAL: Speak in whatever language the user spoke you in the first message. IMPORTANT: You have access to the conversation history. Use previous context to maintain coherence, remember user preferences, and build upon previous explanations. You are a school tutor for students aged 12 to 15. Explain the concept of in a clear and direct way. Use language that is easy to understand, but you can introduce one or two keywords or technical terms and explain them simply within the context. Use practical examples or slightly more elaborate analogies.`,
    '3': `You have max 2000 tokens, adapt your response to that limitation. CRITICAL: Speak in whatever language the user spoke you in the first message. IMPORTANT: You have access to the conversation history. Use previous context to maintain coherence, remember user preferences, and build upon previous explanations. You are a research assistant explaining concepts to a freshman university student. Explain the concept in a structured way and understandable for someone out of high school. Include the easiest formal definitions, fundamental principles, and the key steps of the process. Use appropriate terminology and provide a comprehensive overview of the topic. Explain the most basic concepts if needed.`,
    '4': `You have max 2000 tokens, adapt your response to that limitation. CRITICAL: Speak in whatever language the user spoke you in the first message. IMPORTANT: You have access to the conversation history. Use previous context to maintain coherence, remember user preferences, and build upon previous explanations. You are an expert in the subject. Explain the concept to a colleague who is almost graduated and already has a solid understanding. Use intermediate technical terminology without needing to define it, if it is too advanced then define. Go directly to the details of the process, metabolic pathways, exceptions, molecular subunits, or advanced mechanisms. Do not include analogies or basic summaries.`,
    '5': `You have max 2000 tokens, adapt your response to that limitation. CRITICAL: Speak in whatever language the user spoke you in the first message. IMPORTANT: You have access to the conversation history. Use previous context to maintain coherence, remember user preferences, and build upon previous explanations. You are a senior researcher. Explain the concept at a doctoral level. Do not explain the fundamentals of the topic; instead, delve into points of controversy, current challenges, new lines of research, advanced theoretical models, and the relevance of recent publications in the literature. Make reference to relevant theoretical models or equations.`
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

    console.log(`Session ${sessionId ? sessionId.substring(0, 8) + '...' : 'new'}: ${session.conversationHistory.length} messages in history`);

    // Build messages array
    let messages = [
      {
        "role": "system",
        "content": levels[level]
      }
    ];

    // Add conversation history (but limit context to avoid token overflow)
    // Keep only the most recent 15 exchanges (30 messages) to stay within token limits
    let recentHistory = [];
    try {
      if (session.conversationHistory && Array.isArray(session.conversationHistory)) {
        recentHistory = session.conversationHistory.slice(-30);
      }
    } catch (error) {
      console.error('Error accessing conversation history:', error);
      recentHistory = [];
    }

    // Add conversation history to maintain context
    messages = messages.concat(recentHistory);

    console.log(`Using ${recentHistory.length} messages from conversation history`);

    // Handle current user message
    if (documentPrompt && pdfData) {
      // First time uploading PDF - store it and get annotations
      if (!session.fileAnnotations || session.currentPDF !== fileName) {
        console.log(`Processing new PDF: ${fileName}`);
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
        // Use existing annotations for follow-up questions about the same PDF
        console.log(`Using existing PDF annotations for: ${fileName}`);
        messages.push({
          "role": "user",
          "content": prompt
        });
      }
    } else if (documentPrompt && session.fileAnnotations) {
      // Asking about document but no new PDF data - use existing annotations
      console.log(`Using stored PDF annotations for document questions`);
      messages.push({
        "role": "user",
        "content": prompt
      });
    } else {
      // Regular chat without document
      console.log(`Regular chat message`);
      messages.push({
        "role": "user",
        "content": prompt
      });
    }

    // Call OpenRouter API
    const requestBody = {
      model: 'deepseek/deepseek-chat-v3.1',
      messages: messages,
      max_tokens: 2000,
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
        try {
          // Ensure conversationHistory is an array
          if (!Array.isArray(session.conversationHistory)) {
            session.conversationHistory = [];
          }

          // Determine the actual user message content based on context
          let userMessageContent = prompt;

          // If we have a PDF, include a reference to it in the stored message
          if (documentPrompt && pdfData && (!session.fileAnnotations || session.currentPDF !== fileName)) {
            userMessageContent = `[Uploaded PDF: ${fileName}] ${prompt}`;
          } else if (documentPrompt && session.fileAnnotations) {
            userMessageContent = `[Referring to PDF: ${session.currentPDF}] ${prompt}`;
          }

          // Add user message to history
          session.conversationHistory.push({
            "role": "user",
            "content": userMessageContent
          });

          // Add assistant response to history
          const historyMessage = {
            "role": "assistant",
            "content": assistantMessage.content
          };

          if (assistantMessage.annotations) {
            historyMessage.annotations = assistantMessage.annotations;
          }

          session.conversationHistory.push(historyMessage);

          // Keep only last 20 messages (10 exchanges) to balance context and token limits
          // This gives us ~1500-1800 tokens for conversation history with 2000 max tokens
          if (session.conversationHistory.length > 20) {
            session.conversationHistory = session.conversationHistory.slice(-20);
            console.log(`Trimmed conversation history to last 20 messages (${session.conversationHistory.length} total)`);
          }

          console.log(`Conversation history now has ${session.conversationHistory.length} messages`);
        } catch (error) {
          console.error('Error updating conversation history:', error);
          // Reset conversation history if there's an error
          session.conversationHistory = [];
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

// Debug endpoint to check active sessions (for development)
app.get('/api/debug/sessions', (req, res) => {
  const sessions = {};
  for (const [sessionId, session] of sessionStorage) {
    sessions[sessionId.substring(0, 8) + '...'] = {
      messages: session.conversationHistory.length,
      hasPDF: !!session.currentPDF,
      pdfName: session.currentPDF
    };
  }
  res.json({
    activeSessions: sessionStorage.size,
    sessions: sessions
  });
});

app.listen(port, () => {
  console.log(`🚀 RobotutorAI server running on http://localhost:${port}`);
  console.log(`📚 Conversation memory: Enabled (20 messages max per session)`);
  console.log(`📄 PDF processing: Enabled`);
  console.log(`🔧 Debug endpoint: GET /api/debug/sessions`);
});