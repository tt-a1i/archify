#[cfg(feature="chosen")]fn run(){} #[cfg(not(feature="chosen"))]fn run(){} fn caller(){run();}
