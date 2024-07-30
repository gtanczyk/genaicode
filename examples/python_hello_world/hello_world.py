from termcolor import colored

def main():
    message = "Hello, World!"
    colored_message = colored(message, color="green", on_color="on_blue", attrs=["bold"])
    print(colored_message)

if __name__ == "__main__":
    main()