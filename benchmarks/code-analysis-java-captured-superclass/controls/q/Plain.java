package q;
import p.Api;
class Root { protected int unrelated; }
class Middle extends Root {}
public class Plain extends Middle { public void call() { Api.run(); } }
