extends Node
## A dev-only MCP server inside the running game, so the coding agent can play it.
##
## Add it as an autoload. It listens on http://127.0.0.1:7777/mcp (GENAICODE_GAME_PORT changes the
## port) and serves four tools: game_observe (state and a screenshot), game_take_control,
## game_act (hold keys for some frames) and game_release_control. While the agent has the controls
## the game shows a banner with a Take back control button, and it stays paused between moves.
## The game describes itself through `agent_state()` on a node in the "agent_game" group.
## Release builds do not start it.

const MCP_VERSION := "2025-06-18"
const MAX_FRAMES := 120
const MAX_BODY := 65536
const KEYS := {"left": "ui_left", "right": "ui_right", "up": "ui_up", "down": "ui_down", "accept": "ui_accept"}

var _server := TCPServer.new()
var _clients: Array[Dictionary] = []
var _controlled := false
var _acting := false
var _last_request := 0
var _banner: CanvasLayer


func _ready() -> void:
	if not OS.is_debug_build():
		queue_free()
		return
	process_mode = Node.PROCESS_MODE_ALWAYS
	var port := int(OS.get_environment("GENAICODE_GAME_PORT")) if OS.has_environment("GENAICODE_GAME_PORT") else 7777
	if _server.listen(port, "127.0.0.1") != OK:
		push_warning("genaicode: port %d is taken, the agent cannot play this run" % port)
		return
	print("genaicode: game tools on http://127.0.0.1:%d/mcp" % port)
	_build_banner()


func _process(_delta: float) -> void:
	while _server.is_connection_available():
		_clients.append({"peer": _server.take_connection(), "buffer": PackedByteArray(), "busy": false})
	for client in _clients.duplicate():
		var peer: StreamPeerTCP = client.peer
		peer.poll()
		if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			_clients.erase(client)
			continue
		var available := peer.get_available_bytes()
		if available > 0:
			client.buffer.append_array(peer.get_data(available)[1])
		if not client.busy:
			_next_request(client)
	# The agent CLI ends with its turn and its connections go with it: give the controls back.
	if _controlled and _clients.is_empty() and Time.get_ticks_msec() - _last_request > 5000:
		_set_controlled(false)


func _next_request(client: Dictionary) -> void:
	var text: String = client.buffer.get_string_from_ascii()
	var end := text.find("\r\n\r\n")
	if end < 0:
		if client.buffer.size() > MAX_BODY:
			_respond(client, 413, {"error": "headers too large"})
		return
	var lines := text.substr(0, end).split("\r\n")
	var request_line := lines[0].split(" ")
	var headers := {}
	for line in lines.slice(1):
		var colon := line.find(":")
		if colon > 0:
			headers[line.substr(0, colon).strip_edges().to_lower()] = line.substr(colon + 1).strip_edges()
	var length := int(headers.get("content-length", "0"))
	if length > MAX_BODY:
		_respond(client, 413, {"error": "body too large"})
		return
	if client.buffer.size() < end + 4 + length:
		return
	var body: String = client.buffer.slice(end + 4, end + 4 + length).get_string_from_utf8()
	client.buffer = client.buffer.slice(end + 4 + length)
	client.busy = true
	_last_request = Time.get_ticks_msec()
	_handle(client, request_line[0] if request_line.size() > 0 else "", request_line[1] if request_line.size() > 1 else "", headers, body)


func _handle(client: Dictionary, method: String, path: String, headers: Dictionary, body: String) -> void:
	# Only the agent CLI on this machine: a web page always sends Origin, and a rebound DNS name
	# arrives with its own Host.
	var host: String = headers.get("host", "").get_slice(":", 0)
	if headers.has("origin") or not (host == "127.0.0.1" or host == "localhost"):
		_respond(client, 403, {"error": "forbidden"})
		return
	if path != "/mcp":
		_respond(client, 404, {"error": "not found"})
		return
	if method != "POST":
		_respond(client, 405, {"error": "POST only"})
		return
	var message = JSON.parse_string(body)
	if typeof(message) != TYPE_DICTIONARY:
		_respond(client, 400, {"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": "Parse error"}})
		return
	if not message.has("id"):
		_respond(client, 202, null)
		return
	var params: Dictionary = message.get("params", {}) if typeof(message.get("params")) == TYPE_DICTIONARY else {}
	# JSON numbers parse as floats; answer with the id as it was sent.
	var id = message.id
	if typeof(id) == TYPE_FLOAT and id == floorf(id):
		id = int(id)
	var reply := {"jsonrpc": "2.0", "id": id}
	match message.get("method", ""):
		"initialize":
			reply.result = {
				"protocolVersion": params.get("protocolVersion", MCP_VERSION),
				"capabilities": {"tools": {}},
				"serverInfo": {"name": "godot-game", "version": "1.0.0"},
			}
		"ping":
			reply.result = {}
		"tools/list":
			reply.result = {"tools": _tools()}
		"tools/call":
			var args: Dictionary = params.get("arguments", {}) if typeof(params.get("arguments")) == TYPE_DICTIONARY else {}
			reply.result = await _call(str(params.get("name", "")), args)
		_:
			reply.error = {"code": -32601, "message": "Method not found"}
	_respond(client, 200, reply)


func _respond(client: Dictionary, status: int, value) -> void:
	var peer: StreamPeerTCP = client.peer
	client.busy = false
	if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		return
	var payload := (JSON.stringify(value) if value != null else "").to_utf8_buffer()
	var head := "HTTP/1.1 %d %s\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n" % [
		status, {200: "OK", 202: "Accepted", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 413: "Payload Too Large"}.get(status, "Error"), payload.size()]
	peer.put_data(head.to_ascii_buffer() + payload)


func _tools() -> Array:
	return [
		{
			"name": "game_observe",
			"description": "The running game's state as JSON and a screenshot of the current frame.",
			"inputSchema": {"type": "object", "properties": {}},
			"annotations": {"readOnlyHint": true},
		},
		{
			"name": "game_take_control",
			"description": "Take the controls from the player. The game pauses between your moves until game_release_control.",
			"inputSchema": {"type": "object", "properties": {}},
		},
		{
			"name": "game_act",
			"description": "Hold keys for a number of frames (60 frames is one second), then report the state. Needs game_take_control first.",
			"inputSchema": {
				"type": "object",
				"properties": {
					"keys": {"type": "array", "items": {"type": "string", "enum": KEYS.keys()}},
					"frames": {"type": "integer", "minimum": 1, "maximum": MAX_FRAMES},
				},
				"required": ["keys"],
			},
		},
		{
			"name": "game_release_control",
			"description": "Give the controls back to the player.",
			"inputSchema": {"type": "object", "properties": {}},
		},
	]


func _call(name: String, args: Dictionary) -> Dictionary:
	match name:
		"game_observe":
			return await _observe()
		"game_take_control":
			_set_controlled(true)
			return _text("You have the controls. The game is paused between your moves.")
		"game_release_control":
			_set_controlled(false)
			return _text("The player has the controls again.")
		"game_act":
			if not _controlled:
				return _text("Call game_take_control first.", true)
			# One move at a time, even when calls arrive on several connections.
			if _acting:
				return _text("Another game_act is still running. Wait for it, then act again.", true)
			var actions: Array[String] = []
			for key in args.get("keys", []):
				if not KEYS.has(str(key)):
					return _text("Unknown key %s. Keys: %s" % [key, ", ".join(KEYS.keys())], true)
				actions.append(KEYS[str(key)])
			# The schema is only a hint to the agent; the bound is enforced here.
			var frames := clampi(int(args.get("frames", 10)), 1, MAX_FRAMES)
			_acting = true
			get_tree().paused = false
			for action in actions:
				Input.action_press(action)
			# Physics frames tick at a fixed rate (60 per second by default), so a move lasts as
			# long on a 120 Hz screen as on a 60 Hz one.
			for i in frames:
				await get_tree().physics_frame
				if not _controlled:
					break
			for action in actions:
				Input.action_release(action)
			_acting = false
			if not _controlled:
				return _text("The player took back control.", true)
			get_tree().paused = true
			return _text(JSON.stringify(_state()))
	return _text("Unknown tool %s" % name, true)


func _observe() -> Dictionary:
	var content: Array = [{"type": "text", "text": JSON.stringify(_state())}]
	# Wait for a fresh frame, but not forever: a hidden or occluded window (macOS) may not draw,
	# and then the last frame will do.
	var drawn := [false]
	var on_drawn := func() -> void: drawn[0] = true
	RenderingServer.frame_post_draw.connect(on_drawn, CONNECT_ONE_SHOT)
	var deadline := Time.get_ticks_msec() + 500
	while not drawn[0] and Time.get_ticks_msec() < deadline:
		await get_tree().process_frame
	if RenderingServer.frame_post_draw.is_connected(on_drawn):
		RenderingServer.frame_post_draw.disconnect(on_drawn)
	# A headless run (CI, --headless) has no frames to show.
	var image: Image = null
	if DisplayServer.get_name() != "headless":
		image = get_viewport().get_texture().get_image()
	if image and not image.is_empty():
		image.resize(320, int(320.0 * image.get_height() / image.get_width()))
		content.append({"type": "image", "mimeType": "image/png", "data": Marshalls.raw_to_base64(image.save_png_to_buffer())})
	return {"content": content}


func _state() -> Dictionary:
	var game := get_tree().get_first_node_in_group("agent_game")
	var state: Dictionary = game.agent_state() if game and game.has_method("agent_state") else {}
	state.agent_has_controls = _controlled
	return state


func _text(text: String, error := false) -> Dictionary:
	return {"content": [{"type": "text", "text": text}], "isError": error}


func _set_controlled(on: bool) -> void:
	_controlled = on
	get_tree().paused = on
	if _banner:
		_banner.visible = on


func _build_banner() -> void:
	_banner = CanvasLayer.new()
	_banner.layer = 100
	_banner.visible = false
	var panel := PanelContainer.new()
	panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM, Control.PRESET_MODE_MINSIZE, 12)
	panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var label := Label.new()
	label.text = "Agent controls this game"
	var button := Button.new()
	button.text = "Take back control"
	button.pressed.connect(_set_controlled.bind(false))
	row.add_child(label)
	row.add_child(button)
	panel.add_child(row)
	_banner.add_child(panel)
	add_child(_banner)
