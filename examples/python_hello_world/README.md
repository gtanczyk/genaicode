# Python Hello World App

This is a simple Python application that prints a colorful "Hello, World!" message using the termcolor library.

## Prerequisites

- Python 3.x

## Virtual Environment Setup

It's recommended to use a virtual environment to manage dependencies for this project. Here's how to set it up:

1. Open a terminal and navigate to the project directory.

2. Create a virtual environment:

   ```
   python -m venv venv
   ```

3. Activate the virtual environment:

   - On Windows:
     ```
     venv\Scripts\activate
     ```
   - On macOS and Linux:
     ```
     source venv/bin/activate
     ```

4. Your prompt should change to indicate that the virtual environment is active.

## Setup

1. Clone this repository or download the source code.

2. Activate the virtual environment as described above.

3. Install the required package using pip:
   ```
   pip install -r requirements.txt
   ```

## Running the Application

To run the Hello World application, make sure your virtual environment is activated, then use the following command in your terminal:

```
python hello_world.py
```

You should see a colorful "Hello, World!" message printed in your terminal.

## What it does

The application uses the `termcolor` library to print "Hello, World!" in green text with a blue background and bold formatting.

## File Structure

- `hello_world.py`: The main Python script that prints the Hello World message.
- `requirements.txt`: Lists the required Python packages (termcolor in this case).
- `README.md`: This file, containing instructions and information about the project.

## Deactivating the Virtual Environment

When you're done working on the project, you can deactivate the virtual environment by running:

```
deactivate
```

This will return you to your global Python environment.
