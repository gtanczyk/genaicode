public class HelloWorld {
    public static void main(String[] args) {
        // ANSI escape code for red color
        String ANSI_RED = "\u001B[31m";
        // ANSI escape code to reset color
        String ANSI_RESET = "\u001B[0m";
        System.out.println(ANSI_RED + "Hello, World!" + ANSI_RESET);
    }
}