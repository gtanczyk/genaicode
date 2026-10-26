@tool
extends EditorPlugin
## An "Agent" dock: chat with a coding agent CLI about this project. It runs `genaicode acp`
## (set GENAICODE_ACP_COMMAND to change the command) and hands the agent the running game's
## tools from game_mcp.gd, so the agent can also play the game started with F5.

const AcpClient := preload("res://addons/genaicode/acp_client.gd")

var _client: AcpClient
var _session_id := ""
var _running := false
var _streaming := false
## Permission requests waiting for Allow / Reject, oldest first: [id, title].
var _permissions: Array = []

var _dock: VBoxContainer
var _transcript: RichTextLabel
var _options: HBoxContainer
var _permission: PanelContainer
var _permission_label: Label
var _prompt: LineEdit
var _send: Button
var _stop: Button


func _enter_tree() -> void:
	_build_dock()
	add_control_to_dock(DOCK_SLOT_RIGHT_UL, _dock)
	_connect()


func _exit_tree() -> void:
	if _client:
		_client.stop()
	remove_control_from_docks(_dock)
	_dock.queue_free()


func _process(_delta: float) -> void:
	if _client:
		_client.poll()


func _connect() -> void:
	_client = AcpClient.new()
	_client.update.connect(_on_update)
	_client.permission_requested.connect(_on_permission)
	_client.log_line.connect(func(line: String) -> void: _note(line, "gray"))
	_client.exited.connect(_on_exited)
	var command := OS.get_environment("GENAICODE_ACP_COMMAND")
	if command.is_empty():
		command = "npx -y genaicode acp"
	if _client.start(command) != OK:
		_note("Could not start \"%s\". Is Node.js installed?" % command, "salmon")
		return
	var init = await _client.request("initialize", {"protocolVersion": 1, "clientInfo": {"name": "godot", "version": Engine.get_version_info().string}}).done
	if init[1]:
		_note(init[1].message, "salmon")
		return
	var session = await _client.request("session/new", {
		"cwd": ProjectSettings.globalize_path("res://"),
		"mcpServers": [{"type": "http", "name": "game", "url": _game_mcp_url(), "headers": []}],
	}).done
	if session[1]:
		_note(session[1].message, "salmon")
		return
	_session_id = session[0].sessionId
	_show_options(session[0].get("configOptions", []))
	_note("Ready. Press F5 to run the game, then ask the agent to play it.", "gray")
	_set_running(false)


func _submit(_text := "") -> void:
	var text := _prompt.text.strip_edges()
	if text.is_empty() or _running or _session_id.is_empty():
		return
	_prompt.clear()
	_transcript.append_text("\n[b]You:[/b] %s\n" % _escape(text))
	_set_running(true)
	var reply = await _client.request("session/prompt", {"sessionId": _session_id, "prompt": [{"type": "text", "text": text}]}).done
	_streaming = false
	if reply[1]:
		_note(reply[1].message, "salmon")
	elif reply[0].stopReason == "cancelled":
		_note("Stopped.", "gray")
	_set_running(false)
	# The agent may have changed scripts and scenes.
	EditorInterface.get_resource_filesystem().scan()


func _on_update(update: Dictionary) -> void:
	match update.get("sessionUpdate"):
		"agent_message_chunk":
			if update.content.get("type") == "text":
				if not _streaming:
					_transcript.append_text("\n")
					_streaming = true
				_transcript.append_text(_escape(update.content.text))
		"tool_call":
			_streaming = false
			_note("• %s" % update.get("title", "tool"), "gray")
		"tool_call_update":
			if update.get("status") == "failed":
				_note("  failed", "salmon")


func _on_permission(id: Variant, request: Dictionary) -> void:
	_permissions.append([id, request.toolCall.get("title", "this step")])
	_show_permission()


## Parallel tool calls can ask at once: show the oldest question until it is answered.
func _show_permission() -> void:
	_permission.visible = not _permissions.is_empty()
	if _permission.visible:
		var more := "  (+%d more)" % (_permissions.size() - 1) if _permissions.size() > 1 else ""
		_permission_label.text = "Allow: %s?%s" % [_permissions[0][1], more]


func _answer(option_id: String) -> void:
	if _permissions.is_empty():
		return
	_client.respond(_permissions.pop_front()[0], {"outcome": {"outcome": "selected", "optionId": option_id}})
	_show_permission()


func _cancel() -> void:
	for pending in _permissions:
		_client.respond(pending[0], {"outcome": {"outcome": "cancelled"}})
	_permissions.clear()
	_show_permission()
	_client.notify("session/cancel", {"sessionId": _session_id})


func _show_options(options: Array) -> void:
	for child in _options.get_children():
		child.queue_free()
	for option in options:
		if option.get("type") != "select":
			continue
		var picker := OptionButton.new()
		picker.tooltip_text = option.name
		for choice in option.options:
			picker.add_item(choice.name)
			picker.set_item_metadata(picker.item_count - 1, choice.value)
			if choice.value == option.currentValue:
				picker.select(picker.item_count - 1)
		picker.item_selected.connect(_choose.bind(option.id, picker))
		_options.add_child(picker)


func _choose(index: int, config_id: String, picker: OptionButton) -> void:
	var reply = await _client.request("session/set_config_option", {"sessionId": _session_id, "configId": config_id, "value": picker.get_item_metadata(index)}).done
	if reply[1]:
		_note(reply[1].message, "salmon")
	else:
		_show_options(reply[0].configOptions)


## The session died with the process: no more prompts until the plugin is enabled again.
func _on_exited() -> void:
	_session_id = ""
	_send.disabled = true
	_note("genaicode acp exited. Disable and enable the plugin to start it again.", "salmon")


func _set_running(running: bool) -> void:
	_running = running
	_send.disabled = running or _session_id.is_empty()
	_stop.disabled = not running
	for child in _options.get_children():
		child.disabled = running
	if not running:
		# The turn is over, so the server has settled any question still shown.
		_permissions.clear()
		_show_permission()


func _note(text: String, color: String) -> void:
	_streaming = false
	_transcript.append_text("\n[color=%s]%s[/color]" % [color, _escape(text)])


func _escape(text: String) -> String:
	return text.replace("[", "[lb]")


func _build_dock() -> void:
	_dock = VBoxContainer.new()
	_dock.name = "Agent"
	_options = HBoxContainer.new()
	_dock.add_child(_options)

	_transcript = RichTextLabel.new()
	_transcript.bbcode_enabled = true
	_transcript.scroll_following = true
	_transcript.selection_enabled = true
	_transcript.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_transcript.custom_minimum_size = Vector2(0, 200)
	_dock.add_child(_transcript)

	_permission = PanelContainer.new()
	_permission.visible = false
	var ask := VBoxContainer.new()
	_permission_label = Label.new()
	_permission_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var buttons := HBoxContainer.new()
	var allow := Button.new()
	allow.text = "Allow"
	allow.pressed.connect(_answer.bind("approve"))
	var reject := Button.new()
	reject.text = "Reject"
	reject.pressed.connect(_answer.bind("deny"))
	buttons.add_child(allow)
	buttons.add_child(reject)
	ask.add_child(_permission_label)
	ask.add_child(buttons)
	_permission.add_child(ask)
	_dock.add_child(_permission)

	var row := HBoxContainer.new()
	_prompt = LineEdit.new()
	_prompt.placeholder_text = "Ask the agent..."
	_prompt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_prompt.text_submitted.connect(_submit)
	_send = Button.new()
	_send.text = "Send"
	_send.disabled = true
	_send.pressed.connect(_submit)
	_stop = Button.new()
	_stop.text = "Stop"
	_stop.disabled = true
	_stop.pressed.connect(_cancel)
	row.add_child(_prompt)
	row.add_child(_send)
	row.add_child(_stop)
	_dock.add_child(row)


## The same port game_mcp.gd listens on.
func _game_mcp_url() -> String:
	var port := int(OS.get_environment("GENAICODE_GAME_PORT")) if OS.has_environment("GENAICODE_GAME_PORT") else 7777
	return "http://127.0.0.1:%d/mcp" % port
