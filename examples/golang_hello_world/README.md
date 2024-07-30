# Go Hello World Example

This is a simple "Hello, World!" application written in Go.

## Prerequisites

Make sure you have Go installed on your system. You can download and install Go from the official website: https://golang.org/

## Compiling the Application

To compile the application, follow these steps:

1. Open a terminal or command prompt.
2. Navigate to the directory containing the `main.go` file.
3. Run the following command:

```
go build main.go
```

This will create an executable file named `main` (or `main.exe` on Windows) in the same directory.

## Running the Application

After compiling the application, you can run it using one of the following methods:

### Method 1: Run the compiled executable

Simply run the executable file that was created during the compilation step:

- On Unix-like systems (Linux, macOS):

  ```
  ./main
  ```

- On Windows:
  ```
  main.exe
  ```

### Method 2: Use `go run`

Alternatively, you can use the `go run` command to compile and run the program in one step:

```
go run main.go
```

## Expected Output

When you run the application, you should see the following output:

```
Hello, World!
```

That's it! You've successfully compiled and run a Go "Hello, World!" application.
