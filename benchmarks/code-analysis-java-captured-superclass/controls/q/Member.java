package q;
import p.Api;
class MemberBase { public static class Api { public static void run() {} } }
public class Member extends MemberBase { public void call() { Api.run(); } }
