import os
from dataclasses import dataclass, field
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

@dataclass
class Config:
    # LLM Configuration - Using OpenRouter with NVIDIA Nemotron Nano 9B v2 (Free)
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
    llm_model_name: str = os.getenv("LLM_MODEL_NAME", "nvidia/nemotron-nano-9b-v2:free")
    llm_api_key: str = os.getenv("OPENROUTER_API_KEY", "YOUR_API_KEY_HERE")
    llm_temperature: float = 0.1
    llm_top_p: float = 0.95
    root_dir: str = os.path.dirname(os.path.abspath(__file__))

    # Extended allowed commands for Mac including app launching
    allowed_commands: list = field(default_factory=lambda: [
        # File operations
        "cd", "cp", "ls", "cat", "find", "touch", "echo", "grep", "pwd", "mkdir",
        "sort", "head", "tail", "du", "wc", "which", "whereis", "file",

        # Mac-specific commands
        "open",  # Can open applications and files on Mac

        # Network
        "curl", "wget", "ping",

        # Text processing
        "sed", "awk", "tr", "cut", "uniq",

        # System info
        "date", "whoami", "uname", "df", "ps", "top", "uptime",

        # Python (if needed)
        "python", "python3", "pip", "pip3",

        # Git (if needed)
        "git", "git status", "git log", "git diff",

        # Archive/Compression
        "tar", "zip", "unzip",

        # Process management
        "kill", "killall",
    ])

    @property
    def system_prompt(self) -> str:
        return f"""/think

You are a helpful and very concise Bash assistant with the ability to execute commands in the shell.
You engage with users to help answer questions about bash commands, or execute their intent.
If user intent is unclear, keep engaging with them to figure out what they need and how to best help
them. If they ask question that are not relevant to bash or computer use, decline to answer.

When a command is executed, you will be given the output from that command and any errors. Based on
that, either take further actions or yield control to the user.

The bash interpreter's output and current working directory will be given to you every time a
command is executed. Take that into account for the next conversation.
If there was an error during execution, tell the user what that error was exactly.

You are only allowed to execute the following commands. Break complex tasks into shorter commands from this list:

```
{self.allowed_commands}
```

**Never** attempt to execute a command not in this list. **Never** attempt to execute dangerous commands
like `rm`, `mv`, `rmdir`, `sudo`, `chmod`, `chown`, etc. If the user asks you to do so, politely refuse.

**Special notes for Mac:**
- Use `open -a "Application Name"` to launch applications (e.g., `open -a "Google Chrome"`)
- Use `open URL` to open websites in the default browser (e.g., `open https://google.com`)
- Use `open file.txt` to open files with their default application

Be helpful but always stay within the allowed command list!
"""