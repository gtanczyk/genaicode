@tool
extends EditorPlugin
## A "genaicode" dock: chat with a coding agent CLI about this project. It runs `genaicode acp`
## (set GENAICODE_ACP_COMMAND to change the command) and hands the agent the running game's
## tools from game_mcp.gd, so the agent can also play the game started with F5.

const AcpClient := preload("res://addons/genaicode/acp_client.gd")
const BrowserChat := preload("res://addons/genaicode/browser_chat.gd")

var _client: AcpClient
var _browser: BrowserChat
var _session_id := ""
var _agent_name := ""
var _running := false
## The agent message being streamed: its label and its text so far.
var _reply: RichTextLabel
var _reply_text := ""
var _reply_id := ""
## Tool calls by id, for their status marks.
var _tools := {}
## Permission requests waiting for Allow / Reject, oldest first: [id, title].
var _permissions: Array = []

var _dock: VBoxContainer
var _status: Label
var _options: HBoxContainer
var _scroll: ScrollContainer
var _log: VBoxContainer
var _permission: PanelContainer
var _permission_label: Label
var _prompt: LineEdit
var _send: Button


func _enter_tree() -> void:
	_build_dock()
	add_control_to_dock(DOCK_SLOT_RIGHT_UL, _dock)
	_connect()


func _exit_tree() -> void:
	if _client:
		_client.stop()
	if _browser:
		_browser.stop()
	remove_control_from_docks(_dock)
	_dock.queue_free()


func _process(_delta: float) -> void:
	if _client:
		_client.poll()
	if _browser:
		_browser.poll()


func _connect() -> void:
	_client = AcpClient.new()
	_client.update.connect(_on_update)
	_client.permission_requested.connect(_on_permission)
	_client.log_line.connect(func(line: String) -> void: _note(line))
	_client.exited.connect(_on_exited)
	var command := OS.get_environment("GENAICODE_ACP_COMMAND")
	if command.is_empty():
		command = "npx -y genaicode acp"
	_set_status("starting…")
	if _client.start(command) != OK:
		_note("Could not start \"%s\". Is Node.js installed?" % command, true)
		_set_status("not running")
		return
	var init = await _client.request("initialize", {"protocolVersion": 1, "clientInfo": {"name": "godot", "version": Engine.get_version_info().string}}).done
	if init[1]:
		_note(init[1].message, true)
		_set_status("not running")
		return
	var session = await _client.request("session/new", {
		"cwd": ProjectSettings.globalize_path("res://"),
		"mcpServers": [{"type": "http", "name": "game", "url": _game_mcp_url(), "headers": []}],
	}).done
	if session[1]:
		_note(session[1].message, true)
		_set_status("not running")
		return
	_session_id = session[0].sessionId
	_show_options(session[0].get("configOptions", []))
	_set_running(false)


func _submit(_text := "") -> void:
	if _running:
		_cancel()
		return
	var text := _prompt.text.strip_edges()
	if text.is_empty() or _session_id.is_empty():
		return
	_prompt.clear()
	_add_user(text)
	var prompt: Array = [{"type": "text", "text": text}]
	# The game's tools exist only while it runs (F5); say so, or the agent tries to start Godot itself.
	if not EditorInterface.is_playing_scene():
		_note("The game is not running: press F5 first if the agent should play it.")
		prompt.append({"type": "text", "text": "(Editor note: the game is not running, so the game_* tools are unavailable. If the task needs them, ask the user to press F5 in the Godot editor and send the prompt again. Do not start Godot yourself.)"})
	_set_running(true)
	var reply = await _client.request("session/prompt", {"sessionId": _session_id, "prompt": prompt}).done
	_end_reply()
	if reply[1]:
		_note(reply[1].message, true)
	elif reply[0].stopReason == "cancelled":
		_note("Stopped.")
	_set_running(false)
	# The agent may have changed scripts and scenes.
	EditorInterface.get_resource_filesystem().scan()


func _on_update(update: Dictionary) -> void:
	match update.get("sessionUpdate"):
		"agent_message_chunk":
			if update.content.get("type") != "text":
				return
			var id: String = str(update.get("messageId", ""))
			if _reply == null or id != _reply_id:
				_end_reply()
				_reply = _rich()
				_reply_id = id
				_add(_reply)
			_reply_text += update.content.text
			_reply.text = _markdown(_reply_text)
			_follow()
		"tool_call":
			_end_reply()
			_add_tool(str(update.get("toolCallId", "")), update.get("title", "tool"), update.get("status", "in_progress"))
		"tool_call_update":
			var mark: Label = _tools.get(str(update.get("toolCallId", "")))
			if mark and update.has("status"):
				_mark(mark, update.status)


func _on_permission(id: Variant, request: Dictionary) -> void:
	_permissions.append([id, request.toolCall.get("title", "this step")])
	_show_permission()


## Parallel tool calls can ask at once: show the oldest question until it is answered.
func _show_permission() -> void:
	_permission.visible = not _permissions.is_empty()
	if _permission.visible:
		var more := "\n+%d more waiting" % (_permissions.size() - 1) if _permissions.size() > 1 else ""
		_permission_label.text = "%s%s" % [_permissions[0][1], more]
		_follow()


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
		picker.flat = true
		picker.tooltip_text = option.name
		picker.fit_to_longest_item = false
		for choice in option.options:
			picker.add_item(choice.name)
			picker.set_item_metadata(picker.item_count - 1, choice.value)
			if choice.value == option.currentValue:
				picker.select(picker.item_count - 1)
				if option.id == "agent":
					_agent_name = choice.name
		picker.item_selected.connect(_choose.bind(option.id, picker))
		_options.add_child(picker)
	_set_status("ready")


func _choose(index: int, config_id: String, picker: OptionButton) -> void:
	var reply = await _client.request("session/set_config_option", {"sessionId": _session_id, "configId": config_id, "value": picker.get_item_metadata(index)}).done
	if reply[1]:
		_note(reply[1].message, true)
	else:
		_show_options(reply[0].configOptions)


## The session died with the process: no more prompts until the plugin is enabled again.
func _on_exited() -> void:
	_session_id = ""
	_send.disabled = true
	_set_status("stopped")
	_note("genaicode acp exited. Disable and enable the plugin to start it again.", true)


func _set_running(running: bool) -> void:
	_running = running
	_send.text = "Stop" if running else "Send"
	_send.disabled = _session_id.is_empty()
	_prompt.editable = not running
	for child in _options.get_children():
		child.disabled = running
	if running:
		_set_status("working…")
	elif not _session_id.is_empty():
		_set_status("ready")
	if not running:
		# The turn is over, so the server has settled any question still shown.
		_permissions.clear()
		_show_permission()


func _set_status(text: String) -> void:
	_status.text = "%s · %s" % [_agent_name, text] if _agent_name else text


# --- Transcript -------------------------------------------------------------------------------


func _add(node: Control) -> void:
	_log.add_child(node)
	_follow()


func _follow() -> void:
	if not _dock.is_inside_tree():
		return
	await _dock.get_tree().process_frame
	_scroll.scroll_vertical = int(_scroll.get_v_scroll_bar().max_value)


func _end_reply() -> void:
	_reply = null
	_reply_text = ""
	_reply_id = ""


func _add_user(text: String) -> void:
	_end_reply()
	var bubble := PanelContainer.new()
	bubble.add_theme_stylebox_override("panel", _box(_color("accent_color").darkened(0.55), 8))
	var label := _rich()
	label.text = _escape(text)
	bubble.add_child(label)
	_add(bubble)


func _add_tool(id: String, title: String, status: String) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", int(6 * _scale()))
	var mark := Label.new()
	mark.custom_minimum_size.x = 18 * _scale()
	mark.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	mark.clip_text = true
	_mark(mark, status)
	var title_label := Label.new()
	title_label.text = title
	title_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	title_label.tooltip_text = title
	title_label.mouse_filter = Control.MOUSE_FILTER_PASS
	title_label.add_theme_font_override("font", _editor_theme().get_font("source", "EditorFonts"))
	title_label.add_theme_font_size_override("font_size", int(12 * _scale()))
	title_label.add_theme_color_override("font_color", _muted())
	row.add_child(mark)
	row.add_child(title_label)
	if id:
		_tools[id] = mark
	_add(row)


func _mark(mark: Label, status: String) -> void:
	match status:
		"completed":
			mark.text = "✓"
			mark.add_theme_color_override("font_color", _color("success_color"))
		"failed":
			mark.text = "✗"
			mark.add_theme_color_override("font_color", _color("error_color"))
		_:
			mark.text = "•"
			mark.add_theme_color_override("font_color", _color("accent_color"))


func _note(text: String, error := false) -> void:
	_end_reply()
	var label := Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_color_override("font_color", _color("error_color") if error else _muted())
	label.add_theme_font_size_override("font_size", int(12 * _scale()))
	_add(label)


func _rich() -> RichTextLabel:
	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.selection_enabled = true
	label.scroll_active = false
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	# The editor theme gives RichTextLabel a dark panel and a focus ring; the bubbles draw their own.
	label.add_theme_stylebox_override("normal", StyleBoxEmpty.new())
	label.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	label.add_theme_font_override("mono_font", _editor_theme().get_font("source", "EditorFonts"))
	return label


## Just enough Markdown for agent replies: code, bold and headings.
func _markdown(text: String) -> String:
	var out := _escape(text)
	var code := "[code][color=#%s]$1[/color][/code]" % _color("accent_color").lightened(0.3).to_html(false)
	out = _replace(out, "```[a-z]*\\n?([\\s\\S]*?)\\n?```", code)
	out = _replace(out, "`([^`\\n]+)`", code)
	out = _replace(out, "\\*\\*([^*\\n]+)\\*\\*", "[b]$1[/b]")
	out = _replace(out, "(?m)^#{1,6} +(.+)$", "[b]$1[/b]")
	return out


func _replace(text: String, pattern: String, with: String) -> String:
	var regex := RegEx.create_from_string(pattern)
	return regex.sub(text, with, true)


func _escape(text: String) -> String:
	return text.replace("[", "[lb]")


# --- Layout -----------------------------------------------------------------------------------


func _build_dock() -> void:
	var s := _scale()
	_dock = VBoxContainer.new()
	_dock.name = "genaicode"
	_dock.add_theme_constant_override("separation", int(6 * s))

	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", int(8 * s))
	var wolf := TextureRect.new()
	wolf.texture = _wolf()
	wolf.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	wolf.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	wolf.custom_minimum_size = Vector2(26, 26) * s
	var title := Label.new()
	title.text = "genaicode"
	title.add_theme_font_override("font", _editor_theme().get_font("bold", "EditorFonts"))
	title.add_theme_font_size_override("font_size", int(15 * s))
	_status = Label.new()
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_status.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_status.add_theme_color_override("font_color", _muted())
	var browser := Button.new()
	browser.flat = true
	browser.icon = _editor_theme().get_icon("ExternalLink", "EditorIcons")
	browser.tooltip_text = "Open the full chat in the browser (genaicode ui)"
	browser.pressed.connect(_open_browser)
	header.add_child(wolf)
	header.add_child(title)
	header.add_child(_status)
	header.add_child(browser)
	_dock.add_child(header)

	_options = HBoxContainer.new()
	_dock.add_child(_options)

	_scroll = ScrollContainer.new()
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.custom_minimum_size = Vector2(0, 200 * s)
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var page := PanelContainer.new()
	page.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	page.size_flags_vertical = Control.SIZE_EXPAND_FILL
	page.add_theme_stylebox_override("panel", _box(_color("dark_color_2"), 6, 10))
	_log = VBoxContainer.new()
	_log.add_theme_constant_override("separation", int(8 * s))
	page.add_child(_log)
	_scroll.add_child(page)
	_dock.add_child(_scroll)
	_note("Ask about this project, or press F5 and ask the agent to play the game.")

	_permission = PanelContainer.new()
	_permission.visible = false
	var warning := _color("warning_color")
	var box := _box(warning.darkened(0.75), 8)
	box.border_color = warning
	box.set_border_width_all(int(max(1, s)))
	_permission.add_theme_stylebox_override("panel", box)
	var ask := VBoxContainer.new()
	var question := Label.new()
	question.text = "Allow this step?"
	question.add_theme_color_override("font_color", warning)
	_permission_label = Label.new()
	_permission_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_permission_label.add_theme_font_override("font", _editor_theme().get_font("source", "EditorFonts"))
	var buttons := HBoxContainer.new()
	var allow := Button.new()
	allow.text = "Allow"
	allow.pressed.connect(_answer.bind("approve"))
	var reject := Button.new()
	reject.text = "Reject"
	reject.pressed.connect(_answer.bind("deny"))
	buttons.add_child(allow)
	buttons.add_child(reject)
	ask.add_child(question)
	ask.add_child(_permission_label)
	ask.add_child(buttons)
	_permission.add_child(ask)
	_dock.add_child(_permission)

	var row := HBoxContainer.new()
	_prompt = LineEdit.new()
	_prompt.placeholder_text = "Ask the agent…"
	_prompt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_prompt.text_submitted.connect(_submit)
	_send = Button.new()
	_send.text = "Send"
	_send.disabled = true
	_send.custom_minimum_size.x = 64 * s
	_send.pressed.connect(_submit)
	row.add_child(_prompt)
	row.add_child(_send)
	_dock.add_child(row)


func _box(color: Color, radius: float, margin := 8.0) -> StyleBoxFlat:
	var s := _scale()
	var box := StyleBoxFlat.new()
	box.bg_color = color
	box.set_corner_radius_all(int(radius * s))
	box.set_content_margin_all(margin * s)
	return box


func _wolf() -> Texture2D:
	# Read the PNG bytes directly so the icon shows before Godot has imported the addon.
	var bytes := FileAccess.get_file_as_bytes(get_script().resource_path.get_base_dir().path_join("wolf.png"))
	var image := Image.new()
	if bytes.is_empty() or image.load_png_from_buffer(bytes) != OK:
		return null
	return ImageTexture.create_from_image(image)


func _editor_theme() -> Theme:
	return EditorInterface.get_editor_theme()


func _color(color_name: String) -> Color:
	return _editor_theme().get_color(color_name, "Editor")


func _muted() -> Color:
	var color := _editor_theme().get_color("font_color", "Label")
	color.a = 0.65
	return color


func _scale() -> float:
	return EditorInterface.get_editor_scale()


## The same port game_mcp.gd listens on.
## The browser chat runs its own session, with the same game tools as the dock.
func _open_browser() -> void:
	if _browser == null:
		_browser = BrowserChat.new()
		_browser.log_line.connect(func(line: String) -> void: _note(line))
	var command := OS.get_environment("GENAICODE_UI_COMMAND")
	if command.is_empty():
		command = "npx -y genaicode ui"
	var args := PackedStringArray(["--no-open", "--exit-with-stdin", "-C", ProjectSettings.globalize_path("res://"), "--mcp", "game=" + _game_mcp_url()])
	if not _browser.is_running():
		_note("Starting the browser chat…")
	if _browser.open(command, args) != OK:
		_note("Could not start \"%s\". Is Node.js installed?" % command, true)


func _game_mcp_url() -> String:
	var port := int(OS.get_environment("GENAICODE_GAME_PORT")) if OS.has_environment("GENAICODE_GAME_PORT") else 7777
	return "http://127.0.0.1:%d/mcp" % port
