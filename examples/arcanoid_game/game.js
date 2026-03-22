// Get the canvas element
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game objects
const paddle = {
  x: canvas.width / 2 - 50,
  y: canvas.height - 20,
  width: 100,
  height: 10,
  dx: 5,
};

const ball = {
  x: canvas.width / 2,
  y: canvas.height - 30,
  radius: 7,
  dx: 3,
  dy: -3,
};

const brickRowCount = 5;
const brickColumnCount = 9;
const brickWidth = 75;
const brickHeight = 20;
const brickPadding = 10;
const brickOffsetTop = 30;
const brickOffsetLeft = 30;

const bricks = [];
for (let c = 0; c < brickColumnCount; c++) {
  bricks[c] = [];
  for (let r = 0; r < brickRowCount; r++) {
    bricks[c][r] = { x: 0, y: 0, status: 1 };
  }
}

let score = 0;
let gamePaused = false;

// Event listeners
document.addEventListener('keydown', keyDownHandler);
document.addEventListener('keyup', keyUpHandler);

let rightPressed = false;
let leftPressed = false;

function keyDownHandler(e) {
  if (e.key === 'Right' || e.key === 'ArrowRight') {
    rightPressed = true;
  } else if (e.key === 'Left' || e.key === 'ArrowLeft') {
    leftPressed = true;
  }
}

function keyUpHandler(e) {
  if (e.key === 'Right' || e.key === 'ArrowRight') {
    rightPressed = false;
  } else if (e.key === 'Left' || e.key === 'ArrowLeft') {
    leftPressed = false;
  }
}

// Game functions
function drawBall() {
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fillStyle = '#0095DD';
  ctx.fill();
  ctx.closePath();
}

function drawPaddle() {
  ctx.beginPath();
  ctx.rect(paddle.x, paddle.y, paddle.width, paddle.height);
  ctx.fillStyle = '#0095DD';
  ctx.fill();
  ctx.closePath();
}

function drawBricks() {
  for (let c = 0; c < brickColumnCount; c++) {
    for (let r = 0; r < brickRowCount; r++) {
      if (bricks[c][r].status === 1) {
        const brickX = c * (brickWidth + brickPadding) + brickOffsetLeft;
        const brickY = r * (brickHeight + brickPadding) + brickOffsetTop;
        bricks[c][r].x = brickX;
        bricks[c][r].y = brickY;
        ctx.beginPath();
        ctx.rect(brickX, brickY, brickWidth, brickHeight);
        ctx.fillStyle = '#0095DD';
        ctx.fill();
        ctx.closePath();
      }
    }
  }
}

function collisionDetection() {
  for (let c = 0; c < brickColumnCount; c++) {
    for (let r = 0; r < brickRowCount; r++) {
      const b = bricks[c][r];
      if (b.status === 1) {
        if (ball.x > b.x && ball.x < b.x + brickWidth && ball.y > b.y && ball.y < b.y + brickHeight) {
          ball.dy = -ball.dy;
          b.status = 0;
          score++;
          updateScore();
          if (score === brickRowCount * brickColumnCount) {
            showMessage('Congratulations! You win!');
            gamePaused = true;
          }
        }
      }
    }
  }
}

function updateScore() {
  document.getElementById('scoreValue').textContent = score;
}

function movePaddle() {
  if (rightPressed && paddle.x < canvas.width - paddle.width) {
    paddle.x += paddle.dx;
  } else if (leftPressed && paddle.x > 0) {
    paddle.x -= paddle.dx;
  }
}

function moveBall() {
  ball.x += ball.dx;
  ball.y += ball.dy;

  // Wall collision detection
  if (ball.x + ball.dx > canvas.width - ball.radius || ball.x + ball.dx < ball.radius) {
    ball.dx = -ball.dx;
  }
  if (ball.y + ball.dy < ball.radius) {
    ball.dy = -ball.dy;
  } else if (ball.y + ball.dy > canvas.height - ball.radius) {
    if (ball.x > paddle.x && ball.x < paddle.x + paddle.width) {
      ball.dy = -ball.dy;
    } else {
      showMessage('Game Over');
      gamePaused = true;
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBricks();
  drawBall();
  drawPaddle();
  collisionDetection();

  if (!gamePaused) {
    movePaddle();
    moveBall();
  }

  requestAnimationFrame(draw);
}

function showMessage(message) {
  const messageContainer = document.getElementById('message-container');
  const messageText = document.getElementById('message-text');
  const continueButton = document.getElementById('continue-button');

  messageText.textContent = message;
  messageContainer.style.display = 'flex';

  continueButton.onclick = () => {
    messageContainer.style.display = 'none';
    if (message === 'Game Over' || message === 'Congratulations! You win!') {
      resetGame();
    } else {
      gamePaused = false;
    }
  };
}

function resetGame() {
  score = 0;
  updateScore();
  gamePaused = false;

  // Reset paddle position
  paddle.x = canvas.width / 2 - paddle.width / 2;

  // Reset ball position and direction
  ball.x = canvas.width / 2;
  ball.y = canvas.height - 30;
  ball.dx = 3;
  ball.dy = -3;

  // Reset bricks
  for (let c = 0; c < brickColumnCount; c++) {
    for (let r = 0; r < brickRowCount; r++) {
      bricks[c][r].status = 1;
    }
  }
}

// Start the game
draw();
