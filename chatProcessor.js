const OpenAI = require('openai');

class ChatProcessor {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.conversationHistory = [];
    this.pendingActions = new Map(); // Store pending actions by ID
  }

  async processUserMessage(userMessage, pendingActions = []) {
    try {
      // Update pending actions
      pendingActions.forEach(action => {
        this.pendingActions.set(action.actionId, action);
      });

      // Add user message to conversation history
      this.conversationHistory.push({
        role: 'user',
        content: userMessage
      });

      // Create system prompt with context
      const systemPrompt = this.createSystemPrompt();
      
      const messages = [
        { role: 'system', content: systemPrompt },
        ...this.conversationHistory.slice(-10) // Keep last 10 messages for context
      ];

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: messages,
        temperature: 0.7,
        max_tokens: 500
      });

      const aiResponse = completion.choices[0].message.content;

      // Add AI response to conversation history
      this.conversationHistory.push({
        role: 'assistant',
        content: aiResponse
      });

      return {
        response: aiResponse,
        actions: this.extractActionsFromResponse(aiResponse)
      };

    } catch (error) {
      console.error('Error processing chat message:', error);
      return {
        response: "I'm sorry, I'm having trouble processing your request right now. Please try again.",
        actions: []
      };
    }
  }

  createSystemPrompt() {
    const pendingActionsText = Array.from(this.pendingActions.values())
      .map(action => {
        return `Action ID: ${action.actionId}
Type: ${action.type}
Description: ${action.description}
Details: ${JSON.stringify(action.details)}
From message: "${action.originalMessage.body}" by ${action.originalMessage.fromName}
Confidence: ${Math.round(action.confidence * 100)}%`;
      }).join('\n\n');

    return `You are an AI assistant that helps users manage actions detected from their WhatsApp conversations. You can:

1. Discuss detected actions with the user
2. Help refine action details (title, content, datetime, priority)
3. Create, modify, or dismiss actions based on user feedback
4. Answer questions about the actions and their context

Current pending actions:
${pendingActionsText || 'No pending actions'}

Guidelines:
- Be conversational and helpful
- When user approves an action, respond with "ACTION_APPROVED: <actionId>" in your response
- When user rejects an action, respond with "ACTION_REJECTED: <actionId>" in your response  
- When user wants to modify an action, ask for specific details
- When creating new actions, use "ACTION_CREATE: <type>|<title>|<content>|<datetime>|<priority>" format
- Be proactive in suggesting improvements to detected actions
- Always be clear about what actions you're taking

Example responses:
- "I found a reminder in your conversation. Would you like me to create it for 2PM tomorrow?"
- "ACTION_APPROVED: action_123" (when user confirms)
- "ACTION_CREATE: reminder|Call John|Follow up on project status|2024-01-15T14:00:00|high"`;
  }

  extractActionsFromResponse(response) {
    const actions = [];
    
    // Extract action approvals
    const approvalMatches = response.match(/ACTION_APPROVED:\s*([^\s]+)/g);
    if (approvalMatches) {
      approvalMatches.forEach(match => {
        const actionId = match.replace('ACTION_APPROVED:', '').trim();
        actions.push({ type: 'approve', actionId });
      });
    }

    // Extract action rejections
    const rejectionMatches = response.match(/ACTION_REJECTED:\s*([^\s]+)/g);
    if (rejectionMatches) {
      rejectionMatches.forEach(match => {
        const actionId = match.replace('ACTION_REJECTED:', '').trim();
        actions.push({ type: 'reject', actionId });
      });
    }

    // Extract new action creations
    const createMatches = response.match(/ACTION_CREATE:\s*([^|]+)\|([^|]+)\|([^|]+)\|([^|]*)\|([^|]+)/g);
    if (createMatches) {
      createMatches.forEach(match => {
        const parts = match.replace('ACTION_CREATE:', '').trim().split('|');
        if (parts.length >= 4) {
          actions.push({
            type: 'create',
            actionType: parts[0].trim(),
            title: parts[1].trim(),
            content: parts[2].trim(),
            datetime: parts[3].trim() || undefined,
            priority: parts[4]?.trim() || 'medium'
          });
        }
      });
    }

    return actions;
  }

  addDetectedAction(action) {
    this.pendingActions.set(action.actionId, action);
    
    // Automatically notify about new action
    const message = `I detected a new ${action.type} from your WhatsApp conversation:

**${action.description}**

From: ${action.originalMessage.fromName}
Message: "${action.originalMessage.body}"

Would you like me to create this ${action.type}? I can help you refine the details if needed.`;

    return message;
  }

  removeAction(actionId) {
    this.pendingActions.delete(actionId);
  }

  clearConversation() {
    this.conversationHistory = [];
  }
}

module.exports = ChatProcessor;