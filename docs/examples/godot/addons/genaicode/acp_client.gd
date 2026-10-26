@tool
extends RefCounted
## A small Agent Client Protocol client: starts `genaicode acp` and speaks JSON-RPC over its
## stdin and stdout, one message per line. Call poll() every frame.

signal update(update: Dictionary)
signal permission_requested(id: Variant, request: Dictionary)
signal log_line(text: String)
signal exited

class Reply:
	extends RefCounted
	signal done(result: Variant, error: Variant)

var _stdio: FileAccess
var _stderr: FileAccess
var _pid := -1
var _buffer := PackedByteArray()
var _next_id := 0
var _pending := {}


## Start the server. `command` is split on spaces, e.g. "npx -y genaicode acp".
func start(command: String) -> Error:
	var parts := command.split(" ", false)
	var program := parts[0]
	var args := parts.slice(1)
	if OS.get_name() == "Windows":
		# npx is a .cmd script there.
		args = PackedStringArray(["/c", program]) + args
		program = "cmd.exe"
	var info := OS.execute_with_pipe(program, args, false)
	if info.is_empty():
		return FAILED
	_stdio = info.stdio
	_stderr = info.stderr
	_pid = info.pid
	return OK


func stop() -> void:
	if _pid > 0 and OS.is_process_running(_pid):
		OS.kill(_pid)
	_pid = -1
	_fail_pending("genaicode acp stopped")


func is_running() -> bool:
	return _pid > 0 and OS.is_process_running(_pid)


func request(method: String, params: Dictionary) -> Reply:
	_next_id += 1
	var reply := Reply.new()
	_pending[_next_id] = reply
	_send({"jsonrpc": "2.0", "id": _next_id, "method": method, "params": params})
	return reply


func notify(method: String, params: Dictionary) -> void:
	_send({"jsonrpc": "2.0", "method": method, "params": params})


func respond(id: Variant, result: Dictionary) -> void:
	_send({"jsonrpc": "2.0", "id": id, "result": result})


## Read what the server wrote since the last call and dispatch it.
func poll() -> void:
	if _stderr:
		var errors := _read_available(_stderr)
		if not errors.is_empty():
			for line in errors.get_string_from_utf8().split("\n", false):
				log_line.emit(line)
	if _stdio:
		_buffer.append_array(_read_available(_stdio))
		var newline := _buffer.find(10)
		while newline >= 0:
			var line := _buffer.slice(0, newline).get_string_from_utf8()
			_buffer = _buffer.slice(newline + 1)
			_receive(line)
			newline = _buffer.find(10)
	if _pid > 0 and not OS.is_process_running(_pid):
		_pid = -1
		_fail_pending("genaicode acp exited")
		exited.emit()


## End every request still waiting, so callers awaiting a Reply can go on.
func _fail_pending(reason: String) -> void:
	var pending := _pending
	_pending = {}
	for id in pending:
		pending[id].done.emit(null, {"message": reason})


func _read_available(pipe: FileAccess) -> PackedByteArray:
	# On a pipe opened without blocking, get_length() is what can be read right now.
	var available := pipe.get_length()
	return pipe.get_buffer(available) if available > 0 else PackedByteArray()


func _send(message: Dictionary) -> void:
	if not _stdio:
		return
	_stdio.store_string(JSON.stringify(message) + "\n")
	_stdio.flush()


func _receive(line: String) -> void:
	var message = JSON.parse_string(line)
	if typeof(message) != TYPE_DICTIONARY:
		return
	var method: String = message.get("method", "")
	if method == "session/update":
		update.emit(message.params.update)
	elif method == "session/request_permission":
		permission_requested.emit(message.id, message.params)
	elif method != "" and message.has("id"):
		_send({"jsonrpc": "2.0", "id": message.id, "error": {"code": -32601, "message": "Method not found"}})
	elif message.has("id"):
		var id := int(message.id)
		if _pending.has(id):
			var reply: Reply = _pending[id]
			_pending.erase(id)
			reply.done.emit(message.get("result"), message.get("error"))
