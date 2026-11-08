package q;
import p.Api;
class StaticFieldBase { protected static p.Other Api; }
public class StaticField extends StaticFieldBase { public void call() { Api.run(); } }
