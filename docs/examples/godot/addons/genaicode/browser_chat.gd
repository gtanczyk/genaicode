@tool
extends RefCounted
## Runs `genaicode ui`, the full browser chat, with the same game tools as the dock, and opens
## its link. The browser keeps its own session. Call poll() every frame.

signal log_line(text: String)

var _stdio: FileAccess
var _stderr: FileAccess
var _pid := -1
var _lines := ""
var _url := ""


## Start the server, or open the link again when it already runs. `command` is split on
## spaces, e.g. "npx -y genaicode ui"; `args` are passed as they are.
func open(command: String, args: PackedStringArray) -> Error:
	if is_running():
		if _url:
			OS.shell_open(_url)
		return OK
	var parts := command.split(" ", false)
	var program := parts[0]
	var all_args := parts.slice(1) + args
	if OS.get_name() == "Windows":
		# npx is a .cmd script there.
		all_args = PackedStringArray(["/c", program]) + all_args
		program = "cmd.exe"
	var info := OS.execute_with_pipe(program, all_args, false)
	if info.is_empty():
		return FAILED
	_stdio = info.stdio
	_stderr = info.stderr
	_pid = info.pid
	_url = ""
	_lines = ""
	return OK


func is_running() -> bool:
	return _pid > 0 and OS.is_process_running(_pid)


func stop() -> void:
	if is_running():
		OS.kill(_pid)
	_pid = -1


func poll() -> void:
	if _pid < 0:
		return
	if _stdio:
		_read_available(_stdio)
	if _stderr:
		_lines += _read_available(_stderr).get_string_from_utf8()
		var newline := _lines.find("\n")
		while newline >= 0:
			_receive(_lines.substr(0, newline).strip_edges())
			_lines = _lines.substr(newline + 1)
			newline = _lines.find("\n")
	if not OS.is_process_running(_pid):
		_pid = -1
		log_line.emit("The browser chat stopped.")


## `genaicode ui` prints "Open <link>" once it listens; the link carries its access token.
func _receive(line: String) -> void:
	if line.begins_with("Open http"):
		_url = line.substr(5)
		OS.shell_open(_url)
	elif line and not line.begins_with("(the link carries"):
		log_line.emit(line)


func _read_available(pipe: FileAccess) -> PackedByteArray:
	# On a pipe opened without blocking, get_length() is what can be read right now.
	var available := pipe.get_length()
	return pipe.get_buffer(available) if available > 0 else PackedByteArray()
