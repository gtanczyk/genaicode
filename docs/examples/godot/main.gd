extends Node2D
## A tiny game for the agent to play: steer the square onto the star.

const SPEED := 200.0
const ARENA := Vector2(640, 360)

var player := Vector2(320, 180)
var star := Vector2.ZERO
var score := 0


func _ready() -> void:
	randomize()
	_place_star()
	add_to_group("agent_game") # GameMcp asks this node for agent_state()


func _process(delta: float) -> void:
	var direction := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	player = (player + direction * SPEED * delta).clamp(Vector2(10, 10), ARENA - Vector2(10, 10))
	if player.distance_to(star) < 20:
		score += 1
		_place_star()
	queue_redraw()


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, ARENA), Color("1d2330"))
	draw_circle(star, 10, Color("f5c542"))
	draw_rect(Rect2(player - Vector2(10, 10), Vector2(20, 20)), Color("4fa3ff"))
	draw_string(ThemeDB.fallback_font, Vector2(12, 28), "Score: %d" % score, HORIZONTAL_ALIGNMENT_LEFT, -1, 20)


## What the agent reads besides the frame: positions in pixels, y grows downwards.
func agent_state() -> Dictionary:
	return {
		"player": [roundi(player.x), roundi(player.y)],
		"star": [roundi(star.x), roundi(star.y)],
		"score": score,
		"arena": [int(ARENA.x), int(ARENA.y)],
		"speed_px_per_second": SPEED,
		"keys": ["left", "right", "up", "down"],
	}


func _place_star() -> void:
	star = Vector2(randf_range(30, ARENA.x - 30), randf_range(50, ARENA.y - 30))
