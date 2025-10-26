from typing import Any, Dict, List, Tuple
from openai import OpenAI
from config import Config

class Messages:
    """
    Handles message management for the conversation with the LLM.
    """
    def __init__(self, system_message: str = ""):
        self.system_message = None
        self.messages = []
        self.set_system_message(system_message)

    def set_system_message(self, message: str):
        """Set the system message that defines the LLM's behavior."""
        self.system_message = {"role": "system", "content": message}

    def add_user_message(self, message: str):
        """Add a user message to the conversation."""
        self.messages.append({"role": "user", "content": message})

    def add_assistant_message(self, message: str):
        """Add an assistant message to the conversation."""
        self.messages.append({"role": "assistant", "content": message})

    def add_tool_message(self, message: str, tool_call_id: str):
        """Add a tool result message to the conversation."""
        self.messages.append({
            "role": "tool",
            "content": str(message),
            "tool_call_id": tool_call_id
        })

    def to_list(self) -> List[Dict[str, str]]:
        """Convert the messages to a list for API consumption."""
        return [self.system_message] + self.messages

class LLM:
    """
    Handles communication with the LLM via OpenAI-compatible API.
    """
    def __init__(self, config: Config):
        # Initialize OpenAI client (same as original NVIDIA implementation)
        self.client = OpenAI(
            base_url=config.llm_base_url,
            api_key=config.llm_api_key
        )
        self.config = config
        print(f"[INFO] Using model '{config.llm_model_name}' from '{config.llm_base_url}'")

    def query(
        self,
        messages: Messages,
        tools: List[Dict[str, Any]],
        max_tokens: int = None,
    ) -> Tuple[str, List[Dict[str, Any]]]:
        """
        Send a query to the LLM and get back the response and any tool calls.

        Args:
            messages: The conversation messages
            tools: List of available tools in JSON schema format
            max_tokens: Maximum tokens for the response (optional)

        Returns:
            Tuple of (response_text, tool_calls)
        """
        try:
            completion = self.client.chat.completions.create(
                model=self.config.llm_model_name,
                messages=messages.to_list(),
                tools=tools,
                temperature=self.config.llm_temperature,
                top_p=self.config.llm_top_p,
                max_tokens=max_tokens,
                stream=False
            )

            message = completion.choices[0].message
            return (message.content, message.tool_calls or [])

        except Exception as e:
            print(f"[ERROR] LLM query failed: {e}")
            return ("Sorry, I encountered an error while processing your request.", [])