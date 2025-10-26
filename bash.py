from typing import Any, Dict, List
import re
import shlex
import subprocess
import os

from config import Config

class Bash:
    """
    An implementation of a tool that executes bash commands and keeps track of the working directory.
    """

    def __init__(self, config: Config):
        self.config = config
        # The current working directory (this is tracked and updated throughout the session)
        self.cwd = config.root_dir
        # Set the initial working directory
        self.exec_bash_command(f"cd {self.cwd}")

    def exec_bash_command(self, cmd: str) -> Dict[str, str]:
        """
        Execute the bash command after checking the allowlist and safety patterns.
        """
        if cmd:
            # Prevent command injection via backticks or $ for command substitution
            if re.search(r"[`$\(\)]", cmd):
                return {"error": "Command injection patterns are not allowed."}

            # Prevent pipes and redirects for safety (can be enabled later if needed)
            if re.search(r"[|>]", cmd):
                return {"error": "Pipes and redirects are not currently allowed for safety."}

            # Check the allowlist
            for cmd_part in self._split_commands(cmd):
                # Strip any flags and get the base command
                base_cmd = cmd_part.split()[0] if cmd_part else ""
                if base_cmd not in self.config.allowed_commands:
                    return {"error": f"Command '{base_cmd}' is not in the allowlist."}

            return self._run_bash_command(cmd)

        return {"error": "No command was provided"}

    def to_json_schema(self) -> Dict[str, Any]:
        """
        Convert the function signature to a JSON schema for LLM tool calling.
        """
        return {
            "type": "function",
            "function": {
                "name": "exec_bash_command",
                "description": "Execute a bash command and return stdout/stderr and the working directory",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "cmd": {
                            "type": "string",
                            "description": "The bash command to execute"
                        }
                    },
                    "required": ["cmd"],
                },
            },
        }

    def _split_commands(self, cmd_str: str) -> List[str]:
        """
        Split a command string into individual commands, without the parameters.
        """
        parts = re.split(r'[;&|]+', cmd_str)
        commands = []

        for part in parts:
            tokens = shlex.split(part.strip())
            if tokens:
                commands.append(tokens[0])

        return commands

    def _run_bash_command(self, cmd: str) -> Dict[str, str]:
        """
        Runs the bash command and catches exceptions (if any).
        """
        stdout = ""
        stderr = ""
        new_cwd = self.cwd

        try:
            # Special handling for cd command
            if cmd.strip().startswith("cd "):
                # Extract the directory path
                dir_path = cmd.strip()[3:].strip()
                if dir_path == "~":
                    new_cwd = os.path.expanduser("~")
                elif os.path.isabs(dir_path):
                    new_cwd = dir_path
                else:
                    new_cwd = os.path.join(self.cwd, dir_path)

                # Normalize the path
                new_cwd = os.path.abspath(new_cwd)

                # Check if directory exists
                if os.path.isdir(new_cwd):
                    self.cwd = new_cwd
                    stdout = f"Changed directory to: {new_cwd}"
                else:
                    stderr = f"Directory does not exist: {new_cwd}"
            else:
                # For all other commands, execute and capture working directory
                wrapped = f"{cmd};echo __END__;pwd"
                result = subprocess.run(
                    wrapped,
                    shell=True,
                    cwd=self.cwd,
                    capture_output=True,
                    text=True,
                    executable="/bin/bash"
                )

                stderr = result.stderr
                split = result.stdout.split("__END__")
                stdout = split[0].strip()

                if not stdout and not stderr:
                    stdout = "Command executed successfully, without any output."

                new_cwd = split[-1].strip()
                self.cwd = new_cwd

        except Exception as e:
            stdout = ""
            stderr = str(e)

        return {"stdout": stdout, "stderr": stderr, "cwd": new_cwd}