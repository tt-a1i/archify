trait T{fn run();} fn caller<F:T>(){F::run();}
