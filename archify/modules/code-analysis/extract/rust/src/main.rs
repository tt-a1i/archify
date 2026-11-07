// Source-only Rust evidence. Input is captured JSON; project files and build
// scripts are never opened or executed by this helper.
use proc_macro2::Span;
use quote::ToTokens;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{self, Read},
};
use syn::{
    parse::Parser,
    punctuated::Punctuated,
    spanned::Spanned,
    visit::{self, Visit},
    *,
};

type State = i8; // -1 excluded, 0 conditional/unknown, 1 selected source profile.
fn and(a: State, b: State) -> State {
    if a < 0 || b < 0 {
        -1
    } else if a == 0 || b == 0 {
        0
    } else {
        1
    }
}
fn norm(p: &str) -> String {
    let mut out = Vec::new();
    for part in p.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if out.pop().is_none() {
                    return "<outside>".into();
                }
            }
            _ => out.push(part),
        }
    }
    out.join("/")
}
fn dir(p: &str) -> String {
    p.rsplit_once('/').map(|x| x.0).unwrap_or("").into()
}
fn join(a: &str, b: &str) -> String {
    norm(&format!("{a}/{b}"))
}
fn path_parts(p: &syn::Path) -> Vec<String> {
    p.segments.iter().map(|s| s.ident.to_string()).collect()
}
fn meta_list(m: &MetaList) -> Vec<Meta> {
    Punctuated::<Meta, Token![,]>::parse_terminated
        .parse2(m.tokens.clone())
        .map(|v| v.into_iter().collect())
        .unwrap_or_default()
}

#[derive(Clone)]
struct UseName {
    alias: Option<String>,
    path: Vec<String>,
    absolute: bool,
}
fn flatten_use(tree: &UseTree, absolute: bool) -> Vec<UseName> {
    fn walk(tree: &UseTree, mut prefix: Vec<String>, absolute: bool, out: &mut Vec<UseName>) {
        match tree {
            UseTree::Path(p) => {
                prefix.push(p.ident.to_string());
                walk(&p.tree, prefix, absolute, out)
            }
            UseTree::Group(g) => {
                for item in &g.items {
                    walk(item, prefix.clone(), absolute, out)
                }
            }
            UseTree::Name(n) => {
                let name = n.ident.to_string();
                if name != "self" {
                    prefix.push(name.clone())
                }
                let alias = if name == "self" {
                    prefix.last().cloned().unwrap_or(name)
                } else {
                    name
                };
                out.push(UseName {
                    alias: Some(alias),
                    path: prefix,
                    absolute,
                })
            }
            UseTree::Rename(n) => {
                if n.ident != "self" {
                    prefix.push(n.ident.to_string())
                }
                out.push(UseName {
                    alias: Some(n.rename.to_string()),
                    path: prefix,
                    absolute,
                })
            }
            UseTree::Glob(_) => out.push(UseName {
                alias: None,
                path: prefix,
                absolute,
            }),
        }
    }
    let mut out = Vec::new();
    walk(tree, Vec::new(), absolute, &mut out);
    out
}
#[derive(Clone)]
enum Binding {
    External(String),
    Module(usize),
    Function(usize),
    Nominal(usize, String),
    Inherent(usize),
    Use(Vec<String>, bool),
    Other,
}
#[derive(Clone)]
struct Module {
    krate: usize,
    parent: Option<usize>,
    file: String,
    path: String,
    state: State,
    bindings: BTreeMap<String, Vec<Binding>>,
    globs: Vec<Vec<String>>,
    uncertain_glob: bool,
    use_lines: BTreeMap<String, usize>,
}
#[derive(Clone)]
struct Function {
    module: usize,
    file: String,
    name: String,
    qualname: String,
    state: State,
    start: usize,
    end: usize,
    owned_start: usize,
    body: Block,
    params: Vec<String>,
    generics: Vec<String>,
}
#[derive(Clone)]
struct Krate {
    id: String,
    root: String,
    edition: String,
    deps: BTreeMap<String, String>,
    features: BTreeSet<String>,
}
struct Analysis {
    sources: BTreeMap<String, String>,
    asts: BTreeMap<String, syn::File>,
    offsets: BTreeMap<String, usize>,
    crates: Vec<Krate>,
    roots: BTreeMap<String, usize>,
    modules: Vec<Module>,
    functions: Vec<Function>,
    inherent_pending: Vec<(usize, Vec<String>, String, usize)>,
    inherent: BTreeMap<(usize, String, String), Vec<usize>>,
    variants: BTreeSet<(usize, String, String)>,
    cfg: BTreeSet<String>,
    tests: bool,
    selected: BTreeSet<String>,
    excluded_regions: Vec<Value>,
    parse_errors: Vec<Value>,
    imports: Vec<Value>,
    calls: Vec<Value>,
    opaque: Vec<Value>,
    missing: Vec<Value>,
}
impl Analysis {
    fn point(&self, file: &str, offset: usize) -> (usize, usize) {
        let text = &self.sources[file];
        let offset = offset.min(text.len());
        let before = &text[..offset];
        let line = before.bytes().filter(|b| *b == b'\n').count() + 1;
        let col = before
            .rsplit('\n')
            .next()
            .unwrap_or("")
            .encode_utf16()
            .count()
            + 1;
        (line, col)
    }
    fn bytes(&self, file: &str, span: Span) -> (usize, usize) {
        let r = span.byte_range();
        let offset = self.offsets.get(file).copied().unwrap_or(0);
        (r.start + offset, r.end + offset)
    }
    fn range(&self, file: &str, a: usize, b: usize) -> Value {
        let (l, c) = self.point(file, a);
        let (el, ec) = self.point(file, b);
        json!({"line":l,"column":c,"endLine":el,"endColumn":ec})
    }
    fn cfg_meta(&self, meta: &Meta, krate: usize) -> State {
        match meta {
            Meta::Path(p) => {
                let k = p.to_token_stream().to_string();
                if k == "test" {
                    if self.tests {
                        1
                    } else {
                        -1
                    }
                } else if self.cfg.contains(&k) {
                    1
                } else if ["unix", "windows", "debug_assertions", "proc_macro"]
                    .contains(&k.as_str())
                {
                    -1
                } else {
                    0
                }
            }
            Meta::NameValue(n) => {
                let k = n.path.to_token_stream().to_string();
                if let Expr::Lit(ExprLit {
                    lit: Lit::Str(v), ..
                }) = &n.value
                {
                    if k == "feature" {
                        if self.crates[krate].features.contains(&v.value()) {
                            1
                        } else {
                            -1
                        }
                    } else if [
                        "target_arch",
                        "target_endian",
                        "target_env",
                        "target_family",
                        "target_feature",
                        "target_has_atomic",
                        "target_os",
                        "target_pointer_width",
                        "target_vendor",
                        "target_abi",
                    ]
                    .contains(&k.as_str())
                        || self
                            .cfg
                            .iter()
                            .any(|value| value.starts_with(&format!("{k}=")))
                    {
                        if self.cfg.contains(&format!("{k}=\"{}\"", v.value())) {
                            1
                        } else {
                            -1
                        }
                    } else {
                        0
                    }
                } else {
                    0
                }
            }
            Meta::List(m) => {
                let items = meta_list(m);
                let states: Vec<_> = items.iter().map(|x| self.cfg_meta(x, krate)).collect();
                if m.path.is_ident("all") {
                    states.into_iter().fold(1, and)
                } else if m.path.is_ident("any") {
                    if states.contains(&1) {
                        1
                    } else if states.contains(&0) {
                        0
                    } else {
                        -1
                    }
                } else if m.path.is_ident("not") && states.len() == 1 {
                    -states[0]
                } else {
                    0
                }
            }
        }
    }
    fn attrs(&self, attrs: &[Attribute], krate: usize) -> State {
        let mut state = 1;
        for a in attrs {
            if a.path().is_ident("cfg") {
                if let Meta::List(m) = &a.meta {
                    let items = meta_list(m);
                    state = and(
                        state,
                        if items.len() == 1 {
                            self.cfg_meta(&items[0], krate)
                        } else {
                            0
                        },
                    );
                }
            } else if a.path().is_ident("test") || a.path().is_ident("bench") {
                state = and(state, if self.tests { 1 } else { -1 });
            } else if a.path().is_ident("cfg_attr") {
                if let Meta::List(m) = &a.meta {
                    let items = meta_list(m);
                    if items.len() > 1 {
                        let condition = self.cfg_meta(&items[0], krate);
                        for nested in &items[1..] {
                            if nested.path().is_ident("cfg") {
                                if condition == 0 {
                                    state = and(state, 0)
                                } else if condition == 1 {
                                    if let Meta::List(x) = nested {
                                        let args = meta_list(x);
                                        state = and(
                                            state,
                                            if args.len() == 1 {
                                                self.cfg_meta(&args[0], krate)
                                            } else {
                                                0
                                            },
                                        );
                                    }
                                }
                            } else if (nested.path().is_ident("path") && condition == 0)
                                || (condition >= 0 && !builtin_attribute(nested.path()))
                            {
                                state = and(state, 0)
                            }
                        }
                    }
                }
            } else if !builtin_attribute(a.path()) {
                state = and(state, 0);
            }
        }
        state
    }
    fn add_binding(&mut self, module: usize, name: String, binding: Binding) {
        self.modules[module]
            .bindings
            .entry(name)
            .or_default()
            .push(binding)
    }
    fn use_tree(
        &mut self,
        module: usize,
        _prefix: Vec<String>,
        tree: &UseTree,
        absolute: bool,
        line: usize,
    ) {
        for use_name in flatten_use(tree, absolute) {
            if let Some(alias) = use_name.alias {
                self.modules[module].use_lines.insert(alias.clone(), line);
                self.add_binding(
                    module,
                    alias,
                    Binding::Use(use_name.path, use_name.absolute),
                );
            } else {
                self.modules[module].globs.push(use_name.path)
            }
        }
    }
    fn module_path_meta(
        &self,
        meta: &Meta,
        krate: usize,
    ) -> std::result::Result<Option<String>, ()> {
        if meta.path().is_ident("path") {
            if let Meta::NameValue(n) = meta {
                if let Expr::Lit(ExprLit {
                    lit: Lit::Str(s), ..
                }) = &n.value
                {
                    return Ok(Some(s.value()));
                }
            }
            return Err(());
        }
        if meta.path().is_ident("cfg_attr") {
            if let Meta::List(list) = meta {
                let items = meta_list(list);
                if items.is_empty() {
                    return Err(());
                }
                let state = self.cfg_meta(&items[0], krate);
                if state < 0 {
                    return Ok(None);
                }
                let mut result = None;
                for nested in &items[1..] {
                    if state == 0
                        && (nested.path().is_ident("path") || nested.path().is_ident("cfg_attr"))
                    {
                        return Err(());
                    }
                    if state == 1 {
                        if let Some(path) = self.module_path_meta(nested, krate)? {
                            if result.is_some() {
                                return Err(());
                            }
                            result = Some(path)
                        }
                    }
                }
                return Ok(result);
            }
        }
        Ok(None)
    }
    fn register_fn(
        &mut self,
        module: usize,
        file: &str,
        f: &ItemFn,
        qual: String,
        state: State,
    ) -> usize {
        let span = match f.vis {
            Visibility::Inherited => f.sig.span(),
            _ => f.vis.span(),
        };
        let (start, _) = self.bytes(file, span);
        let (_, end) = self.bytes(file, f.block.span());
        let (owned_start, _) = self.bytes(file, f.span());
        let mut params = Vec::new();
        for arg in &f.sig.inputs {
            if let FnArg::Typed(p) = arg {
                pattern_names(&p.pat, &mut params)
            }
        }
        let generics = f
            .sig
            .generics
            .params
            .iter()
            .filter_map(|p| match p {
                GenericParam::Type(t) => Some(t.ident.to_string()),
                _ => None,
            })
            .collect();
        for attr in &f.attrs {
            if !builtin_attribute(attr.path()) {
                self.opaque.push(json!({"file":file,"line":self.point(file,self.bytes(file,attr.span()).0).0,"kind":"attribute-expansion","name":attr.path().to_token_stream().to_string()}));
            }
        }
        let index = self.functions.len();
        self.functions.push(Function {
            module,
            file: file.into(),
            name: f.sig.ident.to_string(),
            qualname: qual,
            state,
            start,
            end,
            owned_start,
            body: *f.block.clone(),
            params,
            generics,
        });
        index
    }
    fn parse(&mut self, file: &str) -> Option<syn::File> {
        if let Some(ast) = self.asts.get(file) {
            return Some(ast.clone());
        }
        let text = self.sources.get(file)?.clone();
        let mut prefix = if text.starts_with('\u{feff}') { 3 } else { 0 };
        let input = &text[prefix..];
        if input.starts_with("#!") && !input[2..].trim_start().starts_with('[') {
            prefix += input.find('\n').unwrap_or(input.len());
        }
        match syn::parse_file(&text) {
            Ok(ast) => {
                self.offsets.insert(file.into(), prefix);
                self.asts.insert(file.into(), ast.clone());
                Some(ast)
            }
            Err(e) => {
                self.selected.insert(file.into());
                self.parse_errors
                    .push(json!({"path":file,"message":e.to_string()}));
                None
            }
        }
    }
    fn module(
        &mut self,
        krate: usize,
        parent: Option<usize>,
        file: String,
        mod_path: String,
        mod_dir: String,
        items: Vec<Item>,
        state: State,
    ) -> usize {
        let id = self.modules.len();
        self.selected.insert(file.clone());
        self.modules.push(Module {
            krate,
            parent,
            file: file.clone(),
            path: mod_path.clone(),
            state,
            bindings: BTreeMap::new(),
            globs: Vec::new(),
            uncertain_glob: false,
            use_lines: BTreeMap::new(),
        });
        for item in items {
            let attrs = item_attrs(&item);
            let selected = and(state, self.attrs(attrs, krate));
            if selected < 0 {
                let (a, b) = self.bytes(&file, item.span());
                self.excluded_regions.push(json!({"file":file,"range":self.range(&file,a,b),"reason":"cfg-or-test-not-selected"}));
                continue;
            }
            match item {
                Item::Fn(f) => {
                    let name = f.sig.ident.to_string();
                    let qual = if mod_path.is_empty() {
                        name.clone()
                    } else {
                        format!("{mod_path}::{name}")
                    };
                    let index = self.register_fn(id, &file, &f, qual, selected);
                    self.add_binding(id, name, Binding::Function(index));
                }
                Item::Use(u) => {
                    if selected == 1 {
                        let use_line = self.point(&file, self.bytes(&file, u.use_token.span).0).0;
                        self.use_tree(id, Vec::new(), &u.tree, u.leading_colon.is_some(), use_line);
                    } else {
                        if flatten_use(&u.tree, u.leading_colon.is_some())
                            .iter()
                            .any(|name| name.alias.is_none())
                        {
                            self.modules[id].uncertain_glob = true;
                        }
                        let mut names = Vec::new();
                        use_names(&u.tree, &mut names);
                        for name in names {
                            self.add_binding(id, name, Binding::Other)
                        }
                    }
                }
                Item::Mod(m) => {
                    let name = m.ident.to_string();
                    let child_path = if mod_path.is_empty() {
                        name.clone()
                    } else {
                        format!("{mod_path}::{name}")
                    };
                    if let Some((_, items)) = m.content {
                        let child = self.module(
                            krate,
                            Some(id),
                            file.clone(),
                            child_path,
                            join(&mod_dir, &name),
                            items,
                            selected,
                        );
                        self.add_binding(id, name, Binding::Module(child));
                    } else {
                        let mut explicit = None;
                        let mut unknown_path = false;
                        for attr in &m.attrs {
                            match self.module_path_meta(&attr.meta, krate) {
                                Ok(Some(p)) => {
                                    if explicit.is_some() {
                                        unknown_path = true
                                    }
                                    explicit = Some(p)
                                }
                                Err(_) => unknown_path = true,
                                _ => {}
                            }
                        }
                        if unknown_path {
                            self.missing.push(json!({"file":file,"module":name,"reason":"module-path-attribute-unknown-or-ambiguous"}));
                            self.add_binding(id, name, Binding::Other);
                            continue;
                        }
                        let candidates = if let Some(p) = explicit {
                            vec![join(
                                &if parent.map_or(false, |p| self.modules[p].file == file) {
                                    mod_dir.clone()
                                } else {
                                    dir(&file)
                                },
                                &p,
                            )]
                        } else {
                            vec![
                                join(&mod_dir, &format!("{name}.rs")),
                                join(&mod_dir, &format!("{name}/mod.rs")),
                            ]
                        };
                        let found: Vec<_> = candidates
                            .into_iter()
                            .filter(|p| self.sources.contains_key(p))
                            .collect();
                        if found.len() == 1 {
                            let child_file = found[0].clone();
                            let mut ancestor = Some(id);
                            let mut recursive = false;
                            while let Some(parent) = ancestor {
                                if self.modules[parent].file == child_file {
                                    recursive = true;
                                    break;
                                }
                                ancestor = self.modules[parent].parent;
                            }
                            if recursive {
                                self.missing.push(json!({"file":file,"module":name,"reason":"recursive-module-source"}));
                                self.add_binding(id, name, Binding::Other);
                                continue;
                            }
                            if let Some(ast) = self.parse(&child_file) {
                                let stem = child_file
                                    .rsplit('/')
                                    .next()
                                    .unwrap()
                                    .trim_end_matches(".rs");
                                let child_dir = if stem == "mod" {
                                    dir(&child_file)
                                } else {
                                    join(&dir(&child_file), stem)
                                };
                                let child = self.module(
                                    krate,
                                    Some(id),
                                    child_file.clone(),
                                    child_path,
                                    child_dir,
                                    ast.items,
                                    selected,
                                );
                                self.add_binding(id, name, Binding::Module(child));
                                let mut import = json!({"from":file,"to":child_file,"specifier":format!("mod {}",m.ident),"kind":"static","line":self.point(&file,self.bytes(&file,m.ident.span()).0).0,"resolved":true});
                                if selected == 0 {
                                    import["conditional"] = json!(true)
                                }
                                self.imports.push(import);
                            } else {
                                self.add_binding(id, name, Binding::Other)
                            }
                        } else {
                            self.missing.push(json!({"file":file,"module":name,"reason":if found.is_empty(){"module-source-not-captured"}else{"ambiguous-module-files"}}));
                            self.add_binding(id, name, Binding::Other)
                        }
                    }
                }
                Item::Trait(s) => self.add_binding(id, s.ident.to_string(), Binding::Other),
                Item::Union(s) => self.add_binding(id, s.ident.to_string(), Binding::Other),
                Item::Struct(s) => {
                    let name = s.ident.to_string();
                    let binding = if selected == 1 && s.generics.params.is_empty() {
                        Binding::Nominal(id, name.clone())
                    } else {
                        Binding::Other
                    };
                    self.add_binding(id, name, binding);
                }
                Item::Enum(s) => {
                    let name = s.ident.to_string();
                    for variant in &s.variants {
                        // A tuple variant wins over a same-named inherent fn.
                        // Keep all variant names blocked, including unknown cfg.
                        self.variants
                            .insert((id, name.clone(), variant.ident.to_string()));
                    }
                    let binding = if selected == 1 && s.generics.params.is_empty() {
                        Binding::Nominal(id, name.clone())
                    } else {
                        Binding::Other
                    };
                    self.add_binding(id, name, binding);
                }
                Item::Type(s) => self.add_binding(id, s.ident.to_string(), Binding::Other),
                Item::Const(s) => self.add_binding(id, s.ident.to_string(), Binding::Other),
                Item::Static(s) => self.add_binding(id, s.ident.to_string(), Binding::Other),
                Item::Impl(im) => {
                    let owner = im.self_ty.to_token_stream().to_string();
                    // Only an explicit monomorphic nominal owner; trait impls and
                    // specialized/generic impl applicability are not source proof.
                    let owner_path = if im.trait_.is_none() && im.generics.params.is_empty() {
                        match im.self_ty.as_ref() {
                            Type::Path(p)
                                if p.qself.is_none()
                                    && p.path.leading_colon.is_none()
                                    && p.path
                                        .segments
                                        .iter()
                                        .all(|s| matches!(s.arguments, PathArguments::None)) =>
                            {
                                Some(path_parts(&p.path))
                            }
                            _ => None,
                        }
                    } else {
                        None
                    };
                    let impl_types: Vec<String> = im
                        .generics
                        .type_params()
                        .map(|p| p.ident.to_string())
                        .collect();
                    for i in im.items {
                        if let ImplItem::Fn(f) = i {
                            let item = ItemFn {
                                attrs: f.attrs.clone(),
                                vis: f.vis.clone(),
                                sig: f.sig.clone(),
                                block: Box::new(f.block),
                            };
                            let cfg = and(selected, self.attrs(&item.attrs, krate));
                            if cfg >= 0 {
                                let index = self.register_fn(
                                    id,
                                    &file,
                                    &item,
                                    format!("{mod_path}::{owner}::{}", item.sig.ident),
                                    cfg,
                                );
                                self.functions[index].generics.extend(impl_types.clone());
                                if item.sig.receiver().is_none() {
                                    if let Some(path) = &owner_path {
                                        self.inherent_pending.push((
                                            id,
                                            path.clone(),
                                            item.sig.ident.to_string(),
                                            index,
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
                Item::Macro(m) => {
                    self.opaque.push(json!({"file":file,"line":self.point(&file,self.bytes(&file,m.span()).0).0,"kind":if m.mac.path.is_ident("macro_rules"){"definition"}else{"item-expansion"}}));
                }
                Item::ExternCrate(e) => {
                    let alias = e
                        .rename
                        .as_ref()
                        .map(|(_, n)| n.to_string())
                        .unwrap_or(e.ident.to_string());
                    let target = if e.ident == "self" {
                        Some(self.crates[krate].id.clone())
                    } else {
                        self.crates[krate].deps.get(&e.ident.to_string()).cloned()
                    };
                    if let Some(cid) = target {
                        self.add_binding(id, alias, Binding::External(cid));
                    } else {
                        self.add_binding(id, alias, Binding::Other);
                    }
                }
                _ => {}
            }
        }
        id
    }
    fn lookup(&self, module: usize, name: &str, depth: usize) -> Option<Binding> {
        if depth > 32 {
            return None;
        }
        let m = &self.modules[module];
        if let Some(bindings) = m.bindings.get(name) {
            if bindings.len() != 1 {
                return None;
            }
            return self.follow(module, bindings[0].clone(), depth + 1);
        }
        if m.uncertain_glob {
            return Some(Binding::Other);
        }
        let mut found = Vec::new();
        for glob in &m.globs {
            if let Some(Binding::Module(other)) = self.resolve(module, glob, false, true, depth + 1)
            {
                if let Some(binding) = self.lookup(other, name, depth + 1) {
                    found.push(binding)
                }
            }
        }
        if found.len() == 1 {
            Some(found.remove(0))
        } else {
            None
        }
    }
    fn follow(&self, module: usize, b: Binding, depth: usize) -> Option<Binding> {
        match b {
            Binding::Use(parts, absolute) => self.resolve(module, &parts, absolute, true, depth),
            Binding::Other => Some(Binding::Other),
            Binding::External(id) => self.roots.get(&id).copied().map(Binding::Module),
            _ => Some(b),
        }
    }
    fn resolve(
        &self,
        module: usize,
        parts: &[String],
        absolute: bool,
        is_use: bool,
        depth: usize,
    ) -> Option<Binding> {
        if parts.is_empty() || depth > 32 {
            return None;
        }
        let krate = self.modules[module].krate;
        let root = *self.roots.get(&self.crates[krate].id)?;
        let mut index = 0;
        let mut current;
        if parts[0] == "crate" {
            current = Binding::Module(root);
            index = 1;
        } else if parts[0] == "self" {
            current = Binding::Module(module);
            index = 1;
        } else if parts[0] == "super" {
            let mut m = module;
            while index < parts.len() && parts[index] == "super" {
                m = self.modules[m].parent?;
                index += 1
            }
            current = Binding::Module(m);
        } else {
            let origin = if absolute || (is_use && self.crates[krate].edition == "2015") {
                root
            } else {
                module
            };
            let name = &parts[0];
            current = if let Some(binding) = self.lookup(origin, name, depth + 1) {
                binding
            } else if self.modules[origin].bindings.contains_key(name) {
                return None;
            } else if self.crates[krate].edition != "2015" || absolute {
                let cid = self.crates[krate].deps.get(name)?;
                Binding::Module(*self.roots.get(cid)?)
            } else {
                return None;
            };
            index = 1;
        }
        for part in &parts[index..] {
            current = match current {
                Binding::Module(m) => self.lookup(m, part, depth + 1)?,
                Binding::Nominal(m, name) => {
                    let key = (m, name, part.clone());
                    if self.variants.contains(&key) {
                        return None;
                    }
                    let candidates = self.inherent.get(&key)?;
                    if candidates.len() != 1 {
                        return None;
                    }
                    Binding::Inherent(candidates[0])
                }
                _ => return None,
            };
        }
        Some(current)
    }
}
fn builtin_attribute(path: &syn::Path) -> bool {
    let name = path
        .segments
        .first()
        .map(|s| s.ident.to_string())
        .unwrap_or_default();
    [
        "cfg",
        "cfg_attr",
        "path",
        "doc",
        "inline",
        "cold",
        "deprecated",
        "must_use",
        "allow",
        "warn",
        "deny",
        "forbid",
        "expect",
        "test",
        "bench",
        "ignore",
        "should_panic",
        "repr",
        "derive",
        "non_exhaustive",
        "macro_use",
        "macro_export",
        "no_std",
        "no_main",
        "no_mangle",
        "export_name",
        "link_name",
        "link_section",
        "track_caller",
        "target_feature",
        "instruction_set",
        "automatically_derived",
        "unsafe",
        "clippy",
        "rustfmt",
        "diagnostic",
    ]
    .contains(&name.as_str())
}
fn item_attrs(i: &Item) -> &[Attribute] {
    match i {
        Item::Fn(x) => &x.attrs,
        Item::Mod(x) => &x.attrs,
        Item::Use(x) => &x.attrs,
        Item::Impl(x) => &x.attrs,
        Item::Struct(x) => &x.attrs,
        Item::Enum(x) => &x.attrs,
        Item::Const(x) => &x.attrs,
        Item::Static(x) => &x.attrs,
        Item::Type(x) => &x.attrs,
        Item::Macro(x) => &x.attrs,
        _ => &[],
    }
}
fn use_names(tree: &UseTree, out: &mut Vec<String>) {
    out.extend(flatten_use(tree, false).into_iter().filter_map(|u| u.alias));
}
fn pattern_names(p: &Pat, out: &mut Vec<String>) {
    struct Names<'a>(&'a mut Vec<String>);
    impl<'ast> Visit<'ast> for Names<'_> {
        fn visit_pat_ident(&mut self, p: &'ast PatIdent) {
            self.0.push(p.ident.to_string());
            visit::visit_pat_ident(self, p)
        }
    }
    Names(out).visit_pat(p)
}
fn expr_attrs(expr: &Expr) -> &[Attribute] {
    macro_rules! get {($($kind:ident),*)=>{match expr {$(Expr::$kind(x)=>&x.attrs,)* _=>&[]}}}
    get!(
        Array, Assign, Async, Await, Binary, Block, Break, Call, Cast, Closure, Const, Continue,
        Field, ForLoop, Group, If, Index, Infer, Let, Lit, Loop, Macro, Match, MethodCall, Paren,
        Path, Range, RawAddr, Reference, Repeat, Return, Struct, Try, TryBlock, Tuple, Unary,
        Unsafe, While, Yield
    )
}

#[derive(Clone, Default)]
struct Scope {
    uncertain_glob: bool,
    values: BTreeSet<String>,
    types: BTreeSet<String>,
    uses: BTreeMap<String, (Vec<String>, bool)>,
    globs: Vec<Vec<String>>,
}
fn signature_scope(sig: &Signature) -> Scope {
    let mut scope = Scope::default();
    scope
        .types
        .extend(sig.generics.type_params().map(|p| p.ident.to_string()));
    for arg in &sig.inputs {
        if let FnArg::Typed(p) = arg {
            let mut names = Vec::new();
            pattern_names(&p.pat, &mut names);
            scope.values.extend(names);
        }
    }
    scope
}
struct Scanner<'a> {
    a: &'a mut Analysis,
    function: Function,
    scopes: Vec<Scope>,
    state: State,
}
impl Scanner<'_> {
    fn excluded(&mut self, span: Span) {
        let file = &self.function.file;
        let (start, end) = self.a.bytes(file, span);
        self.a.excluded_regions.push(json!({"file":file,"range":self.a.range(file,start,end),"reason":"cfg-or-test-not-selected"}));
    }
    fn call(&mut self, span: Span, path: Option<&ExprPath>, reason: &str) {
        let file = self.function.file.clone();
        let (a, b) = self.a.bytes(&file, span);
        let mut r = self.a.range(&file, a, b);
        r["file"] = json!(file);
        r["resolution"] = json!("unresolved");
        r["reason"] = json!(reason);
        if self.state == 0 {
            r["reason"] = json!("rust-cfg-unselected");
        } else if let Some(p) = path {
            let parts = path_parts(&p.path);
            let mut target = None;
            if p.qself.is_none() && !parts.is_empty() {
                target = self.resolve_call_path(p);
            }
            let resolved = match target {
                Some(Binding::Function(index)) => Some((index, "rust-direct-function")),
                Some(Binding::Inherent(index))
                    if p.path
                        .segments
                        .iter()
                        .all(|s| matches!(s.arguments, PathArguments::None)) =>
                {
                    Some((index, "rust-inherent-source-candidate"))
                }
                _ => None,
            };
            if let Some((index, resolution)) = resolved {
                let f = &self.a.functions[index];
                if f.state == 1 {
                    let (line, column) = self.a.point(&f.file, f.start);
                    r["target"] = json!({"file":f.file,"name":f.name,"line":line,"column":column});
                    r["resolution"] = json!(resolution);
                    r.as_object_mut().unwrap().remove("reason");
                } else {
                    r["reason"] = json!("rust-cfg-unselected")
                }
            }
        }
        // Distinct crate contexts at one physical call must agree before navigation.
        r["_crate"] = json!(self.a.crates[self.a.modules[self.function.module].krate].id);
        self.a.calls.push(r);
    }
    fn resolve_call_path(&self, path: &ExprPath) -> Option<Binding> {
        if path.qself.is_some() {
            return None;
        }
        let parts = path_parts(&path.path);
        if parts.is_empty() {
            return None;
        }
        if !["crate", "self", "super"].contains(&parts[0].as_str()) {
            for scope in self.scopes.iter().rev() {
                if scope.uncertain_glob {
                    return None;
                }
                if (parts.len() == 1 && scope.values.contains(&parts[0]))
                    || (parts.len() > 1 && scope.types.contains(&parts[0]))
                {
                    return None;
                }
                if let Some((prefix, absolute)) = scope.uses.get(&parts[0]) {
                    let mut full = prefix.clone();
                    full.extend_from_slice(&parts[1..]);
                    return self
                        .a
                        .resolve(self.function.module, &full, *absolute, true, 0);
                }
                let mut found = Vec::new();
                for glob in &scope.globs {
                    let mut full = glob.clone();
                    full.extend_from_slice(&parts);
                    if let Some(binding) =
                        self.a.resolve(self.function.module, &full, false, true, 0)
                    {
                        found.push(binding)
                    }
                }
                if !found.is_empty() {
                    return if found.len() == 1 { found.pop() } else { None };
                }
            }
        }
        self.a.resolve(
            self.function.module,
            &parts,
            path.path.leading_colon.is_some(),
            false,
            0,
        )
    }
    fn block_scope(&mut self, block: &Block) -> Scope {
        let mut scope = Scope::default();
        let krate = self.a.modules[self.function.module].krate;
        for stmt in &block.stmts {
            if let Stmt::Item(item) = stmt {
                let state = self.a.attrs(item_attrs(item), krate);
                if state < 0 {
                    continue;
                }
                match item {
                    Item::Use(u) => {
                        let line = self
                            .a
                            .point(
                                &self.function.file,
                                self.a.bytes(&self.function.file, u.use_token.span).0,
                            )
                            .0;
                        for use_name in flatten_use(&u.tree, u.leading_colon.is_some()) {
                            let target = if state == 1 {
                                self.a.resolve(
                                    self.function.module,
                                    &use_name.path,
                                    use_name.absolute,
                                    true,
                                    0,
                                )
                            } else {
                                None
                            };
                            let file = match target {
                                Some(Binding::Function(i)) => {
                                    Some(self.a.functions[i].file.clone())
                                }
                                Some(Binding::Module(i)) => Some(self.a.modules[i].file.clone()),
                                _ => None,
                            };
                            let mut record = json!({"from":self.function.file,"specifier":use_name.path.join("::"),"kind":"static","line":line,"resolved":file.is_some()});
                            if let Some(file) = file {
                                record["to"] = json!(file)
                            }
                            if state == 0 {
                                record["conditional"] = json!(true)
                            }
                            if let Some(alias) = use_name.alias {
                                record["names"] = json!([alias]);
                                if state == 0 || scope.uses.contains_key(&alias) {
                                    scope.values.insert(alias.clone());
                                    scope.types.insert(alias.clone());
                                }
                                if state == 1 {
                                    scope.uses.insert(alias, (use_name.path, use_name.absolute));
                                }
                            } else if state == 1 {
                                scope.globs.push(use_name.path)
                            } else {
                                scope.uncertain_glob = true
                            }
                            self.a.imports.push(record);
                        }
                    }
                    Item::Fn(f) => {
                        scope.values.insert(f.sig.ident.to_string());
                    }
                    Item::Struct(x) => {
                        scope.types.insert(x.ident.to_string());
                        scope.values.insert(x.ident.to_string());
                    }
                    Item::Type(x) => {
                        scope.types.insert(x.ident.to_string());
                    }
                    Item::Enum(x) => {
                        scope.types.insert(x.ident.to_string());
                    }
                    Item::Const(x) => {
                        scope.values.insert(x.ident.to_string());
                    }
                    Item::Static(x) => {
                        scope.values.insert(x.ident.to_string());
                    }
                    Item::Mod(x) => {
                        scope.types.insert(x.ident.to_string());
                    }
                    _ => {}
                }
            }
        }
        scope
    }
}
impl<'ast> Visit<'ast> for Scanner<'_> {
    fn visit_expr(&mut self, expr: &'ast Expr) {
        let old = self.state;
        let krate = self.a.modules[self.function.module].krate;
        self.state = and(old, self.a.attrs(expr_attrs(expr), krate));
        if self.state >= 0 {
            visit::visit_expr(self, expr)
        } else {
            let (a, b) = self.a.bytes(&self.function.file, expr.span());
            self.a.excluded_regions.push(json!({"file":self.function.file,"range":self.a.range(&self.function.file,a,b),"reason":"cfg-expression-not-selected"}));
        }
        self.state = old;
    }

    fn visit_block(&mut self, block: &'ast Block) {
        let scope = self.block_scope(block);
        self.scopes.push(scope);
        for stmt in &block.stmts {
            self.visit_stmt(stmt)
        }
        self.scopes.pop();
    }
    fn visit_local(&mut self, local: &'ast Local) {
        let krate = self.a.modules[self.function.module].krate;
        let previous = self.state;
        self.state = and(self.state, self.a.attrs(&local.attrs, krate));
        if self.state >= 0 {
            if let Some(init) = &local.init {
                self.visit_expr(&init.expr);
                if let Some((_, diverge)) = &init.diverge {
                    self.visit_expr(diverge)
                }
            }
            let mut names = Vec::new();
            pattern_names(&local.pat, &mut names);
            for name in names {
                self.scopes.last_mut().unwrap().values.insert(name);
            }
        }
        self.state = previous;
    }
    fn visit_item_fn(&mut self, f: &'ast ItemFn) {
        let krate = self.a.modules[self.function.module].krate;
        let previous = self.state;
        self.state = and(previous, self.a.attrs(&f.attrs, krate));
        if self.state >= 0 {
            let scope = signature_scope(&f.sig);
            let old = self.scopes.clone();
            self.scopes.push(scope);
            self.visit_block(&f.block);
            self.scopes = old;
        } else {
            self.excluded(f.span());
        }
        self.state = previous;
    }
    // Local impl/trait bodies retain their calls but introduce their own generic
    // scopes. No Self owner is inferred from the surrounding registered function.
    fn visit_item_impl(&mut self, item: &'ast ItemImpl) {
        let previous = self.state;
        let krate = self.a.modules[self.function.module].krate;
        self.state = and(previous, self.a.attrs(&item.attrs, krate));
        let mut scope = Scope::default();
        scope.types.insert("Self".into());
        scope
            .types
            .extend(item.generics.type_params().map(|p| p.ident.to_string()));
        self.scopes.push(scope);
        if self.state >= 0 {
            visit::visit_item_impl(self, item);
        } else {
            self.excluded(item.span());
        }
        self.scopes.pop();
        self.state = previous;
    }
    fn visit_impl_item_fn(&mut self, item: &'ast ImplItemFn) {
        let previous = self.state;
        let krate = self.a.modules[self.function.module].krate;
        self.state = and(previous, self.a.attrs(&item.attrs, krate));
        let scope = signature_scope(&item.sig);
        self.scopes.push(scope);
        if self.state >= 0 {
            self.visit_block(&item.block);
        } else {
            self.excluded(item.span());
        }
        self.scopes.pop();
        self.state = previous;
    }
    fn visit_item_trait(&mut self, item: &'ast ItemTrait) {
        let previous = self.state;
        let krate = self.a.modules[self.function.module].krate;
        self.state = and(previous, self.a.attrs(&item.attrs, krate));
        let mut scope = Scope::default();
        scope.types.insert("Self".into());
        scope
            .types
            .extend(item.generics.type_params().map(|p| p.ident.to_string()));
        self.scopes.push(scope);
        if self.state >= 0 {
            visit::visit_item_trait(self, item);
        } else {
            self.excluded(item.span());
        }
        self.scopes.pop();
        self.state = previous;
    }
    fn visit_trait_item_fn(&mut self, item: &'ast TraitItemFn) {
        let previous = self.state;
        let krate = self.a.modules[self.function.module].krate;
        self.state = and(previous, self.a.attrs(&item.attrs, krate));
        self.scopes.push(signature_scope(&item.sig));
        if self.state >= 0 {
            if let Some(body) = &item.default {
                self.visit_block(body);
            }
        } else {
            self.excluded(item.span());
        }
        self.scopes.pop();
        self.state = previous;
    }
    fn visit_expr_call(&mut self, call: &'ast ExprCall) {
        let mut callee = call.func.as_ref();
        while let Expr::Paren(p) = callee {
            callee = &p.expr
        }
        let path = if let Expr::Path(p) = callee {
            Some(p)
        } else {
            None
        };
        self.call(
            call.span(),
            path,
            if path.is_some() {
                "no-local-function-binding"
            } else {
                "unsupported-callee"
            },
        );
        visit::visit_expr_call(self, call)
    }
    fn visit_expr_method_call(&mut self, call: &'ast ExprMethodCall) {
        self.call(call.span(), None, "rust-trait-or-method-dispatch");
        visit::visit_expr_method_call(self, call)
    }
    fn visit_expr_closure(&mut self, closure: &'ast ExprClosure) {
        let mut scope = Scope::default();
        for p in &closure.inputs {
            let mut names = Vec::new();
            pattern_names(p, &mut names);
            scope.values.extend(names);
        }
        self.scopes.push(scope);
        self.visit_expr(&closure.body);
        self.scopes.pop();
    }
    fn visit_expr_if(&mut self, expr: &'ast ExprIf) {
        self.scopes.push(Scope::default());
        self.visit_expr(&expr.cond);
        self.visit_block(&expr.then_branch);
        self.scopes.pop();
        if let Some((_, other)) = &expr.else_branch {
            self.visit_expr(other)
        }
    }
    fn visit_expr_while(&mut self, expr: &'ast ExprWhile) {
        self.scopes.push(Scope::default());
        self.visit_expr(&expr.cond);
        self.visit_block(&expr.body);
        self.scopes.pop();
    }
    fn visit_expr_let(&mut self, expr: &'ast ExprLet) {
        self.visit_expr(&expr.expr);
        let mut names = Vec::new();
        pattern_names(&expr.pat, &mut names);
        self.scopes.last_mut().unwrap().values.extend(names);
    }
    fn visit_expr_for_loop(&mut self, expr: &'ast ExprForLoop) {
        self.visit_expr(&expr.expr);
        let mut scope = Scope::default();
        let mut names = Vec::new();
        pattern_names(&expr.pat, &mut names);
        scope.values.extend(names);
        self.scopes.push(scope);
        self.visit_block(&expr.body);
        self.scopes.pop();
    }
    fn visit_arm(&mut self, arm: &'ast Arm) {
        let mut scope = Scope::default();
        let mut names = Vec::new();
        pattern_names(&arm.pat, &mut names);
        scope.values.extend(names);
        self.scopes.push(scope);
        if let Some((_, guard)) = &arm.guard {
            self.visit_expr(guard)
        }
        self.visit_expr(&arm.body);
        self.scopes.pop();
    }
    fn visit_macro(&mut self, m: &'ast Macro) {
        self.call(m.span(), None, "rust-macro-not-expanded");
        self.a.opaque.push(json!({"file":self.function.file,"line":self.a.point(&self.function.file,self.a.bytes(&self.function.file,m.span()).0).0,"kind":"expression-expansion"}));
    }
}

#[derive(Default)]
struct Metrics {
    complexity: usize,
    depth: usize,
    nesting: usize,
    deepest: usize,
}
impl<'ast> Visit<'ast> for Metrics {
    fn visit_expr(&mut self, e: &'ast Expr) {
        let branch = matches!(
            e,
            Expr::If(_) | Expr::ForLoop(_) | Expr::While(_) | Expr::Loop(_) | Expr::Match(_)
        );
        if matches!(
            e,
            Expr::If(_) | Expr::ForLoop(_) | Expr::While(_) | Expr::Loop(_)
        ) {
            self.complexity += 1;
        }
        if let Expr::Binary(b) = e {
            if matches!(b.op, BinOp::And(_) | BinOp::Or(_)) {
                self.complexity += 1
            }
        }
        if branch {
            self.depth += 1;
            if self.depth > self.nesting {
                self.nesting = self.depth;
                self.deepest = e.span().start().line;
            }
        }
        visit::visit_expr(self, e);
        if branch {
            self.depth -= 1;
        }
    }
    fn visit_arm(&mut self, a: &'ast Arm) {
        if !matches!(a.pat, Pat::Wild(_)) {
            self.complexity += 1
        }
        visit::visit_arm(self, a)
    }
    fn visit_expr_closure(&mut self, _: &'ast ExprClosure) {}
    fn visit_item_fn(&mut self, _: &'ast ItemFn) {}
}
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let request: Value = serde_json::from_str(&input).unwrap();
    let sources = request["sources"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), v.as_str().unwrap().into()))
        .collect();
    let crates: Vec<Krate> = request["crates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| Krate {
            id: c["id"].as_str().unwrap().into(),
            root: c["root"].as_str().unwrap().into(),
            edition: c["edition"].as_str().unwrap().into(),
            deps: c["deps"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap().into()))
                .collect(),
            features: c["features"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_str().unwrap().into())
                .collect(),
        })
        .collect();
    let cfg = request["cfg"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().replace(' ', ""))
        .collect();
    let mut a = Analysis {
        sources,
        crates,
        cfg,
        tests: request["tests"].as_bool().unwrap_or(false),
        asts: BTreeMap::new(),
        offsets: BTreeMap::new(),
        roots: BTreeMap::new(),
        modules: Vec::new(),
        functions: Vec::new(),
        inherent_pending: Vec::new(),
        inherent: BTreeMap::new(),
        variants: BTreeSet::new(),
        selected: BTreeSet::new(),
        excluded_regions: Vec::new(),
        parse_errors: Vec::new(),
        imports: Vec::new(),
        calls: Vec::new(),
        opaque: Vec::new(),
        missing: Vec::new(),
    };
    for i in 0..a.crates.len() {
        let c = a.crates[i].clone();
        if let Some(ast) = a.parse(&c.root) {
            a.roots.insert(c.id.clone(), a.modules.len());
            a.module(
                i,
                None,
                c.root.clone(),
                String::new(),
                dir(&c.root),
                ast.items,
                1,
            );
        } else {
            a.missing
                .push(json!({"crate":c.id,"file":c.root,"reason":"crate-root-unavailable"}));
        }
    }
    // Resolve owner identity after all module trees and local crate roots exist.
    for (module, path, name, index) in a.inherent_pending.clone() {
        if let Some(Binding::Nominal(owner_module, owner_name)) =
            a.resolve(module, &path, false, false, 0)
        {
            a.inherent
                .entry((owner_module, owner_name, name))
                .or_default()
                .push(index);
        }
    }
    // Import evidence is resolved only after every workspace crate is indexed.
    for m in 0..a.modules.len() {
        let module = a.modules[m].clone();
        for (name, bindings) in &module.bindings {
            for binding in bindings {
                if let Binding::Use(parts, absolute) = binding {
                    let target = a.resolve(m, parts, *absolute, true, 0);
                    let file = match target {
                        Some(Binding::Function(i)) => Some(a.functions[i].file.clone()),
                        Some(Binding::Module(i)) | Some(Binding::Nominal(i, _)) => {
                            Some(a.modules[i].file.clone())
                        }
                        _ => None,
                    };
                    let line = module.use_lines.get(name).copied().unwrap_or(1);
                    let mut record = json!({"from":module.file,"specifier":parts.join("::"),"names":[name],"kind":"static","line":line,"resolved":file.is_some()});
                    if let Some(file) = file {
                        record["to"] = json!(file)
                    }
                    a.imports.push(record);
                }
            }
        }
    }
    for f in a.functions.clone() {
        let mut scope = Scope::default();
        scope.values.extend(f.params.clone());
        scope.types.extend(f.generics.clone());
        let body = f.body.clone();
        let state = f.state;
        let mut scanner = Scanner {
            a: &mut a,
            function: f,
            scopes: vec![scope],
            state,
        };
        scanner.visit_block(&body);
    }
    let mut functions = Vec::new();
    for f in &a.functions {
        let mut range = a.range(&f.file, f.start, f.end);
        range["_start"] = json!(f.start);
        range["_end"] = json!(f.end);
        let mut owned = a.range(&f.file, f.owned_start, f.end);
        owned["_start"] = json!(f.owned_start);
        owned["_end"] = json!(f.end);
        let mut metrics = Metrics {
            complexity: 1,
            ..Metrics::default()
        };
        metrics.visit_block(&f.body);
        let line = range["line"].as_u64().unwrap() as usize;
        functions.push(json!({"file":f.file,"name":f.name,"qualname":f.qualname,"line":line,"endLine":range["endLine"],"complexity":metrics.complexity,"nesting":metrics.nesting,"deepestLine":if metrics.deepest==0{line}else{metrics.deepest},"sourceRange":range,"definition":{"kind":"RustItemFn","sourceRange":owned},"_cfg":f.state}));
    }
    // Deduplicate physical facts across crate contexts; disagreement stays unknown.
    let mut grouped: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for mut call in a.calls {
        call.as_object_mut().unwrap().remove("_crate");
        let k = format!(
            "{}:{}:{}:{}:{}",
            call["file"], call["line"], call["column"], call["endLine"], call["endColumn"]
        );
        grouped.entry(k).or_default().push(call)
    }
    let calls: Vec<Value> = grouped
        .into_values()
        .map(|v| {
            let mut first = v[0].clone();
            if v.iter().any(|x| x != &first) {
                first.as_object_mut().unwrap().remove("target");
                first["resolution"] = json!("unresolved");
                first["reason"] = json!("rust-context-dependent");
            }
            first
        })
        .collect();
    let modules: Vec<_> = a
        .modules
        .iter()
        .map(|m| json!({"crate":a.crates[m.krate].id,"path":m.path,"file":m.file,"cfg":m.state}))
        .collect();
    println!("{}",serde_json::to_string(&json!({"selected":a.selected,"functions":functions,"calls":calls,"imports":a.imports,"modules":modules,"parse_errors":a.parse_errors,"excludedRegions":a.excluded_regions,"opaqueMacros":a.opaque,"missingModules":a.missing})).unwrap());
}
