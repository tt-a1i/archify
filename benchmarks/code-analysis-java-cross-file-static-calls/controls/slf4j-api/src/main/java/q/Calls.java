package q;
import p.Api;
import p.Other;
public class Calls {
 public static void positive() { Api.run(); p.Api.run(); Api.args("value"); }
 public static void parameter(Other Api) { Api.run(); }
 public static void local() { Other Api = null; Api.run(); }
 public static void pattern(Object value) { if(value instanceof Other Api) { Api.run(); } }
 public static void overloaded() { Api.over(); }
 public static void lambda() { java.util.function.Consumer<Other> c = Api -> Api.run(); }
}
class FieldCalls { static Other Api; public static void field() { Api.run(); } }
class Inherited extends Other { public static void inherited() { Api.run(); } }
