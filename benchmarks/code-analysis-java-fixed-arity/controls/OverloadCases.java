public class OverloadCases {
    public static String choose(String x) { return "one"; }
    public static String choose(String x, String y) { return "two"; }
    public static String same(Object x) { return "object"; }
    public static String same(String x) { return "string"; }
    public static String spread(String x) { return "fixed"; }
    public static String spread(Object... x) { return "varargs"; }
    public static void main(String[] args) {
        System.out.println(choose(null));
        System.out.println(choose(null, "x"));
        System.out.println(same("x"));
        System.out.println(spread("x"));
    }
}
