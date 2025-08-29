// Backend API configuration - automatically detect environment
const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000' 
    : window.location.origin;
let document_prompt = false;

// Generate a unique session ID for this browser session
let sessionId = localStorage.getItem('robotutor_session_id');
if (!sessionId) {
    sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2);
    localStorage.setItem('robotutor_session_id', sessionId);
}

// Function to update level descriptions - moved to global scope
function updateLevelDescriptions(level) {
    // Remove active class from all level info elements
    document.querySelectorAll('.level-info').forEach(info => {
        info.classList.remove('active');
    });
    
    // Add active class to current level
    const currentLevelInfo = document.querySelector(`[data-level="${level}"]`);
    if (currentLevelInfo) {
        currentLevelInfo.classList.add('active');
    }
}

// Chat message functions
function addMessage(content, isUser = false) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user' : 'assistant'}`;
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.innerHTML = marked.parse(content);
    
    messageDiv.appendChild(messageContent);
    chatMessages.appendChild(messageDiv);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addLoadingMessage() {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.id = 'loading-message';
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.innerHTML = '<span class="loading"></span> Thinking...';
    
    messageDiv.appendChild(messageContent);
    chatMessages.appendChild(messageDiv);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeLoadingMessage() {
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
        loadingMessage.remove();
    }
}

// handle user input
function handlePromptAsk() {
    let user_prompt = document.getElementById("prompt").value;
    let user_level = document.getElementById("level").value;
    let level_change = false;
    
    if (!user_prompt.trim()) {
        return;
    }

    if (user_prompt == '!increase_level') {
        user_level++;
        level_change = true;
        document.getElementById("level").value = user_level;
        document.getElementById("level-value").textContent = user_level;
        updateLevelDescriptions(user_level);
        document.getElementById("prompt").value = "";
        addMessage(`Level increased to ${user_level}!`, false);
    } else if (user_prompt == '!decrease_level') {
        user_level--;
        level_change = true;
        document.getElementById("level").value = user_level;
        document.getElementById("level-value").textContent = user_level;
        updateLevelDescriptions(user_level);
        document.getElementById("prompt").value = "";
        addMessage(`Level decreased to ${user_level}!`, false);
    } else if (user_prompt == '!clear_pdf') {
        level_change = true;
        clearPDF();
        document.getElementById("prompt").value = "";
    }
    
    console.log("Prompt:", user_prompt, "Level:", user_level);
    
    // Add user message to chat
    if (!level_change) {
        addMessage(user_prompt, true);
        // Clear input
        document.getElementById("prompt").value = "";
        // Call the API
        handlePrompt(user_prompt, user_level, document_prompt);
    }
}
// handle file upload
async function handleFileUpload() {
  const pdfFile = document.getElementById('file-input').files[0];
  if (!pdfFile) {
    throw new Error('No file selected');
  }
  document_prompt = true;
  
  // Show loading state
  const uploadBtn = document.getElementById('upload-btn');
  uploadBtn.classList.add('uploading');
  uploadBtn.querySelector('span').textContent = 'Processing...';
  
  try {
    const base64PDF = await encodePDFToBase64(pdfFile);
    
    // Update button appearance to show file is loaded
    uploadBtn.classList.remove('uploading');
    uploadBtn.classList.add('has-file');
    uploadBtn.querySelector('span').textContent = pdfFile.name.length > 20 ? 
      pdfFile.name.substring(0, 17) + '...' : pdfFile.name;
    
    addMessage(`PDF "${pdfFile.name}" uploaded successfully! You can now ask questions about it. Type "!clear_pdf" to remove the PDF.`, false);
    return base64PDF;
  } catch (error) {
    // Reset button on error
    uploadBtn.classList.remove('uploading');
    uploadBtn.querySelector('span').textContent = 'Upload PDF';
    throw error;
  }
}

// clear PDF function
async function clearPDF() {
  try {
    // Clear PDF from backend session
    const response = await fetch(`${API_BASE_URL}/api/clear-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId: sessionId })
    });

    if (response.ok) {
      // Clear frontend state
      document.getElementById('file-input').value = '';
      document_prompt = false;
      
      // Reset upload button appearance
      const uploadBtn = document.getElementById('upload-btn');
      uploadBtn.classList.remove('has-file');
      uploadBtn.querySelector('span').textContent = 'Upload PDF';
      
      addMessage("PDF and conversation history cleared. You can now ask general questions or upload a new PDF.", false);
    } else {
      addMessage("Error clearing PDF. Please try again.", false);
    }
  } catch (error) {
    console.error("Error clearing PDF:", error);
    addMessage("Error clearing PDF. Please try again.", false);
  }
}

  // encode pdf to base64
async function encodePDFToBase64(pdfFile) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const base64PDF = e.target.result.split(',')[1]; // Remove data:application/pdf;base64, prefix
      resolve(`data:application/pdf;base64,${base64PDF}`);
    };
    reader.onerror = function(error) {
      reject(error);
    };
    reader.readAsDataURL(pdfFile);
  });
}

// handle prompt and send to backend
async function handlePrompt(user_prompt, user_level, document_prompt) {
  try {
    // Add loading message
    addLoadingMessage();
    
    let requestData = {
      prompt: user_prompt,
      level: user_level,
      documentPrompt: document_prompt,
      sessionId: sessionId
    };

    // If there's a PDF, get its data
    if (document_prompt) {
      const pdfFile = document.getElementById('file-input').files[0];
      if (pdfFile) {
        const base64PDF = await encodePDFToBase64(pdfFile);
        requestData.pdfData = base64PDF;
        requestData.fileName = pdfFile.name;
      }
    }

    await sendToBackend(requestData);
  } catch (error) {
    console.error("Error:", error);
    removeLoadingMessage();
    addMessage("Error: " + error.message, false);
  }
}

// send request to backend API
async function sendToBackend(requestData) {
  try {
    console.log('Sending to backend:', requestData);
    
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Backend response error:', response.status, errorData);
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Backend response:', result);
    
    // Remove loading message
    removeLoadingMessage();
    
    if (result.success && result.response) {
      let messageContent = result.response;
      
      // Add indicator if using file annotations
      if (result.hasAnnotations && document_prompt) {
        messageContent += "\n\n*📎 Using PDF annotations for faster processing*";
      }
      
      addMessage(messageContent, false);
    } else {
      throw new Error("Unexpected response format from backend");
    }
    
  } catch (error) {
    console.error("Backend API Error:", error);
    removeLoadingMessage();
    addMessage("Error: " + error.message, false);
  }
}

// Update level display when slider changes
document.addEventListener('DOMContentLoaded', function() {
    const levelSlider = document.getElementById('level');
    const levelValue = document.getElementById('level-value');
    
    // Initialize with level 1
    updateLevelDescriptions(1);
    
    levelSlider.addEventListener('input', function() {
        const currentLevel = this.value;
        levelValue.textContent = currentLevel;
        updateLevelDescriptions(currentLevel);
    });
    
    // Add click functionality to level info buttons
    document.querySelectorAll('.level-info').forEach(levelButton => {
        levelButton.addEventListener('click', function() {
            const newLevel = this.getAttribute('data-level');
            levelSlider.value = newLevel;
            levelValue.textContent = newLevel;
            updateLevelDescriptions(newLevel);
          
        });
    });
    
    // Add welcome message
    addMessage("Hello! I'm RobotutorAI, your adaptive learning companion. I can explain any concept at different complexity levels. What would you like to learn about?", false);
    
    // Add enter key support for input
    document.getElementById('prompt').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            handlePromptAsk();
        }
    });
    
    // Add file input change listener
    document.getElementById('file-input').addEventListener('change', function(e) {
        if (e.target.files.length > 0) {
            handleFileUpload();
        }
    });
});

