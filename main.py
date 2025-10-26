import json
import sys
from config import Config
from bash import Bash
from helpers import Messages, LLM

def confirm_execution(cmd: str) -> bool:
    """Ask the user whether the suggested command should be executed."""
    return input(f"\n    ▶️  Execute '{cmd}'? [y/N]: ").strip().lower() == "y"

def print_assistant_response(response: str):
    """Print the assistant's response in a formatted way."""
    if response:
        # Remove any leading/trailing whitespace and format
        response = response.strip()
        if response:
            print(f"\n🤖: {response}")

def main():
    """Main interactive loop for the Bash Computer Use Agent."""
    config = Config()

    # Check if API key is configured
    if config.llm_api_key == "YOUR_API_KEY_HERE":
        print("\n⚠️  ERROR: API key not configured!")
        print(f"\nPlease edit config.py and set your llm_api_key.")
        print(f"You can get a free key from: https://openrouter.ai/")
        print(f"Supported models include: meta-llama/llama-3.1-8b-instruct:free")
        sys.exit(1)

    # Initialize components
    bash = Bash(config)
    llm = LLM(config)
    messages = Messages(config.system_prompt)

    print("\n" + "="*60)
    print("🚀 BASH COMPUTER USE AGENT")
    print("="*60)
    print(f"\n[INFO] Type 'quit' or 'exit' at any time to exit the agent loop.")
    print(f"[INFO] Type 'help' for examples of what you can do.")
    print(f"[INFO] Current working directory: {bash.cwd}")
    print("="*60 + "\n")

    while True:
        try:
            # Get user input
            user_input = input(f"[{bash.cwd}] 👤 You: ").strip()

            # Check for exit commands
            if user_input.lower() in ['quit', 'exit', 'q']:
                print("\n[🤖] Shutting down. Bye! 👋\n")
                break

            # Skip empty input
            if not user_input:
                continue

            # Help command
            if user_input.lower() == 'help':
                print("\n📚 Examples of what you can ask:")
                print("  • 'List all files in the current directory'")
                print("  • 'Open Chrome browser'")
                print("  • 'Open https://google.com in my browser'")
                print("  • 'Create a new folder called test'")
                print("  • 'Show me what Python is installed'")
                print("  • 'What's the current date and time?'")
                print("  • 'Find all Python files in this directory'")
                print("\n📝 Available commands:", ", ".join(config.allowed_commands[:10]), "...")
                continue

            # Add working directory info to the user message
            user_input_with_context = f"{user_input}\n\nCurrent working directory: `{bash.cwd}`"
            messages.add_user_message(user_input_with_context)

            # Inner loop for handling tool calls
            while True:
                print("\n[🤖] Thinking...")
                response, tool_calls = llm.query(messages, [bash.to_json_schema()])

                # Handle assistant's text response
                if response:
                    # Filter out the /think part and only show the actual response
                    if response.startswith("/think"):
                        response = response[5:].strip()
                    print_assistant_response(response)
                    messages.add_assistant_message(response)

                # Handle tool calls (execute bash commands)
                if tool_calls:
                    for tool_call in tool_calls:
                        function_name = tool_call.function.name
                        function_args = json.loads(tool_call.function.arguments)

                        if function_name == "exec_bash_command":
                            cmd = function_args.get("cmd", "")
                            print(f"\n[🛠️] Suggested command: {cmd}")

                            if confirm_execution(cmd):
                                print("[⚡] Executing...")
                                result = bash.exec_bash_command(cmd)

                                # Display results
                                if "error" in result:
                                    print(f"\n❌ Error: {result['error']}")
                                    messages.add_tool_message(result, tool_call.id)
                                else:
                                    if result.get("stdout"):
                                        print(f"\n📤 Output:\n{result['stdout']}")
                                    if result.get("stderr"):
                                        print(f"\n⚠️  Stderr:\n{result['stderr']}")

                                    # Add tool result to messages
                                    tool_result = {
                                        "stdout": result.get("stdout", ""),
                                        "stderr": result.get("stderr", ""),
                                        "cwd": result.get("cwd", bash.cwd)
                                    }
                                    messages.add_tool_message(tool_result, tool_call.id)
                            else:
                                print("[❌] Command execution cancelled by user.")
                                messages.add_tool_message("Command cancelled by user.", tool_call.id)

                            # Continue the conversation to let the assistant respond to the result
                            continue
                        else:
                            print(f"\n⚠️  Unknown function called: {function_name}")

                # If we're here, we're done with this round of tool calls
                break

        except KeyboardInterrupt:
            print("\n\n[🤖] Interrupted by user. Shutting down. Bye! 👋\n")
            break
        except EOFError:
            # Handle Ctrl+D gracefully
            print("\n\n[🤖] Input ended. Shutting down. Bye! 👋\n")
            break
        except Exception as e:
            print(f"\n❌ Error: {e}")
            print("Continuing...")

if __name__ == "__main__":
    main()