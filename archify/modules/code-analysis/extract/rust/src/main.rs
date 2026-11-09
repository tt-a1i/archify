// Source-only Rust evidence. Input is captured JSON; project files and build
// scripts are never opened or executed by this helper.
use proc_macro2::{Group, Span, TokenStream, TokenTree};
use quote::{quote, ToTokens};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{self, Read},
};
use syn::{
    parse::{Parse, ParseStream, Parser},
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
    // A struct whose generic declaration cannot resolve inherent method paths
    // but whose fields still identify receiver types (defaults, where clauses).
    Fields(usize, String),
    Inherent(usize),
    SpecializedInherent(usize),
    LifetimeInherent(usize),
    Trait(usize),
    Use(Vec<String>, bool),
    Other,
}
#[derive(Clone)]
struct TraitMethod {
    file: String,
    name: String,
    line: usize,
    column: usize,
    qualname: String,
}
#[derive(Clone)]
struct DefaultMethod {
    file: String,
    name: String,
    qualname: String,
    line: usize,
    column: usize,
    trait_name: String,
    trait_index: Option<usize>,
}
#[derive(Clone)]
struct TraitDecl {
    file: String,
    name: String,
    qualname: String,
    line: usize,
    column: usize,
    generics: Vec<String>,
    methods: BTreeMap<String, TraitMethod>,
    returns: BTreeMap<String, TypeHint>,
}
#[derive(Clone)]
struct TraitImplPending {
    module: usize,
    trait_path: Vec<String>,
    absolute: bool,
    self_path: Option<(Vec<String>, bool)>,
    self_type: String,
    method: String,
    function: usize,
    state: State,
}
#[derive(Clone)]
struct TraitImpl {
    trait_decl: usize,
    self_module: Option<usize>,
    self_name: Option<String>,
    self_type: String,
    method: String,
    function: usize,
    state: State,
}
struct TraitImplOwner {
    module: usize,
    trait_path: Vec<String>,
    absolute: bool,
    self_path: Option<(Vec<String>, bool)>,
    has_methods: BTreeSet<String>,
    complete: bool,
    plain: bool,
}
#[derive(Clone)]
struct Module {
    krate: usize,
    parent: Option<usize>,
    file: String,
    path: String,
    state: State,
    declared_at: usize,
    macro_use: bool,
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
    signature: Scope,
    self_type: Option<TypeHint>,
    self_args: Option<Vec<TypeHint>>,
    default_method: Option<DefaultMethod>,
    macro_expanded: bool,
}
#[derive(Clone)]
struct Krate {
    id: String,
    root: String,
    edition: String,
    deps: BTreeMap<String, String>,
    features: BTreeSet<String>,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Parameters {
    None,
    Types(usize),
    Lifetimes(usize),
    Unsupported,
}
fn declaration_parameters(generics: &syn::Generics, allow_types: bool) -> Parameters {
    if generics.params.is_empty() {
        return Parameters::None;
    }
    if generics.where_clause.is_some() {
        return Parameters::Unsupported;
    }
    if allow_types && generics.params.iter().all(|p| matches!(p,
        syn::GenericParam::Type(t) if t.bounds.is_empty() && t.default.is_none() && t.attrs.is_empty())) {
        return Parameters::Types(generics.params.len());
    }
    if generics.params.iter().all(|p| {
        matches!(p,
        syn::GenericParam::Lifetime(l) if l.bounds.is_empty() && l.attrs.is_empty()
            && l.lifetime.ident != "static" && l.lifetime.ident != "_")
    }) {
        return Parameters::Lifetimes(generics.params.len());
    }
    Parameters::Unsupported
}
fn inherent_parameters(im: &syn::ItemImpl, arguments: &PathArguments) -> Parameters {
    // Preserve the historical non-generic owner contract.
    if im.generics.params.is_empty() && matches!(arguments, PathArguments::None) {
        return Parameters::None;
    }
    if let PathArguments::AngleBracketed(args) = arguments {
        if im.generics.params.is_empty()
            && im.generics.where_clause.is_none()
            && args.args.iter().all(|arg| {
                matches!(arg,
                syn::GenericArgument::Type(Type::Path(t)) if t.qself.is_none()
                    && t.path.segments.iter().all(|s| matches!(s.arguments, PathArguments::None)))
            })
        {
            return Parameters::Types(args.args.len());
        }
        if let Parameters::Lifetimes(count) = declaration_parameters(&im.generics, false) {
            let names: BTreeSet<_> = im
                .generics
                .lifetimes()
                .map(|l| l.lifetime.ident.to_string())
                .collect();
            let used: BTreeSet<_> = args
                .args
                .iter()
                .filter_map(|arg| match arg {
                    syn::GenericArgument::Lifetime(l) => Some(l.ident.to_string()),
                    _ => None,
                })
                .collect();
            if args.args.len() == count && names.len() == count && used == names {
                return Parameters::Lifetimes(count);
            }
        }
    }
    Parameters::Unsupported
}
#[derive(Clone)]
struct InherentPending {
    module: usize,
    owner: Vec<String>,
    name: String,
    index: usize,
    parameters: Parameters,
    static_function: bool,
    returns: Option<TypeHint>,
}
#[derive(Clone)]
struct WrapPending {
    module: usize,
    self_path: Option<(Vec<String>, bool)>,
    trait_path: Vec<String>,
    absolute: bool,
    method: String,
    args: Vec<TypeHint>,
    associated: Option<TypeHint>,
}
#[derive(Clone)]
struct MacroRule {
    matcher: TokenStream,
    expansion: TokenStream,
}
#[derive(Clone)]
struct MacroDef {
    name: String,
    file: String,
    line: usize,
    column: usize,
    module: usize,
    krate: usize,
    preserves: bool,
    rules: Vec<MacroRule>,
}
struct ParsedMacroDef {
    rules: Vec<MacroRule>,
}
struct ImplItems(Vec<ImplItem>);
impl Parse for ImplItems {
    fn parse(input: ParseStream) -> Result<Self> {
        let mut items = Vec::new();
        while !input.is_empty() {
            items.push(input.parse()?);
        }
        Ok(ImplItems(items))
    }
}
impl Parse for ParsedMacroDef {
    fn parse(input: ParseStream) -> Result<Self> {
        let mut rules = Vec::new();
        while !input.is_empty() {
            if input.peek(Token![;]) {
                input.parse::<Token![;]>()?;
                continue;
            }
            let matcher_group: TokenTree = input.parse()?;
            let TokenTree::Group(matcher) = matcher_group else {
                return Err(input.error("expected a delimited macro matcher"));
            };
            input.parse::<Token![=>]>()?;
            let expansion_group: TokenTree = input.parse()?;
            let TokenTree::Group(expansion) = expansion_group else {
                return Err(input.error("expected a delimited macro expansion"));
            };
            if input.peek(Token![;]) {
                input.parse::<Token![;]>()?;
            }
            rules.push(MacroRule {
                matcher: matcher.stream(),
                expansion: expansion.stream(),
            });
        }
        Ok(ParsedMacroDef { rules })
    }
}
fn single_expr_matcher(matcher: &TokenStream) -> Option<String> {
    let tokens: Vec<TokenTree> = matcher.clone().into_iter().collect();
    let tokens = match tokens.last() {
        Some(TokenTree::Punct(p)) if p.as_char() == ',' => &tokens[..tokens.len() - 1],
        _ => &tokens[..],
    };
    if tokens.len() != 4 {
        return None;
    }
    match (&tokens[0], &tokens[1], &tokens[2], &tokens[3]) {
        (
            TokenTree::Punct(dollar),
            TokenTree::Ident(name),
            TokenTree::Punct(colon),
            TokenTree::Ident(fragment),
        ) if dollar.as_char() == '$' && colon.as_char() == ':' && fragment == "expr" => {
            Some(name.to_string())
        }
        _ => None,
    }
}
fn metavariable_once(expansion: &TokenStream, name: &str) -> bool {
    fn walk(
        stream: TokenStream,
        name: &str,
        nested_macro: bool,
        count: &mut usize,
        unsafe_use: &mut bool,
    ) {
        let tokens: Vec<TokenTree> = stream.into_iter().collect();
        let mut dollar = false;
        let mut bang = false;
        for token in tokens {
            match token {
                TokenTree::Punct(p) if p.as_char() == '$' => {
                    dollar = true;
                    bang = false;
                }
                TokenTree::Ident(ident) if dollar => {
                    if ident == name {
                        if nested_macro {
                            *unsafe_use = true;
                        }
                        *count += 1;
                    }
                    dollar = false;
                    bang = false;
                }
                TokenTree::Group(group) => {
                    if dollar {
                        // `$( ... )` is a repetition; the metavariable may expand more than once.
                        *unsafe_use = true;
                    }
                    walk(
                        group.stream(),
                        name,
                        nested_macro || bang,
                        count,
                        unsafe_use,
                    );
                    dollar = false;
                    bang = false;
                }
                TokenTree::Punct(p) if p.as_char() == '!' => {
                    bang = true;
                    dollar = false;
                }
                _ => {
                    dollar = false;
                    bang = false;
                }
            }
        }
    }
    let mut count = 0;
    let mut unsafe_use = false;
    walk(expansion.clone(), name, false, &mut count, &mut unsafe_use);
    !unsafe_use && count == 1
}
const MACRO_ARGUMENT_SENTINEL: &str = "__archify_macro_argument";
fn substitute_metavariable(expansion: &TokenStream, name: &str) -> TokenStream {
    fn walk(stream: TokenStream, name: &str, out: &mut TokenStream) {
        let tokens: Vec<TokenTree> = stream.into_iter().collect();
        let mut index = 0;
        while index < tokens.len() {
            if let (TokenTree::Punct(p), Some(TokenTree::Ident(id))) =
                (&tokens[index], tokens.get(index + 1))
            {
                if p.as_char() == '$' && id == name {
                    out.extend([TokenTree::Ident(Ident::new(
                        MACRO_ARGUMENT_SENTINEL,
                        id.span(),
                    ))]);
                    index += 2;
                    continue;
                }
            }
            match &tokens[index] {
                TokenTree::Group(group) => {
                    let mut inner = TokenStream::new();
                    walk(group.stream(), name, &mut inner);
                    let mut replaced = Group::new(group.delimiter(), inner);
                    replaced.set_span(group.span());
                    out.extend([TokenTree::Group(replaced)]);
                }
                token => out.extend([token.clone()]),
            }
            index += 1;
        }
    }
    let mut out = TokenStream::new();
    walk(expansion.clone(), name, &mut out);
    out
}
struct PreserveScan<'a> {
    analysis: &'a Analysis,
    krate: usize,
    count: usize,
    uncertain: bool,
}
impl<'ast> Visit<'ast> for PreserveScan<'_> {
    fn visit_path(&mut self, path: &'ast Path) {
        if path.is_ident(MACRO_ARGUMENT_SENTINEL) {
            self.count += 1;
        }
        visit::visit_path(self, path);
    }
    fn visit_expr(&mut self, expr: &'ast Expr) {
        let state = self.analysis.attrs(expr_attrs(expr), self.krate);
        if state < 0 {
            return;
        }
        if state == 0 {
            self.uncertain = true;
            return;
        }
        visit::visit_expr(self, expr);
    }
    fn visit_local(&mut self, local: &'ast Local) {
        let state = self.analysis.attrs(&local.attrs, self.krate);
        if state < 0 {
            return;
        }
        if state == 0 {
            self.uncertain = true;
            return;
        }
        visit::visit_local(self, local);
    }
    fn visit_item(&mut self, item: &'ast Item) {
        let state = self.analysis.attrs(item_attrs(item), self.krate);
        if state < 0 {
            return;
        }
        if state == 0 {
            self.uncertain = true;
            return;
        }
        visit::visit_item(self, item);
    }
    fn visit_arm(&mut self, arm: &'ast Arm) {
        let state = self.analysis.attrs(&arm.attrs, self.krate);
        if state < 0 {
            return;
        }
        if state == 0 {
            self.uncertain = true;
            return;
        }
        visit::visit_arm(self, arm);
    }
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        if let Stmt::Macro(m) = stmt {
            let state = self.analysis.attrs(&m.attrs, self.krate);
            if state < 0 {
                return;
            }
            if state == 0 {
                self.uncertain = true;
                return;
            }
        }
        visit::visit_stmt(self, stmt);
    }
    fn visit_macro(&mut self, m: &'ast Macro) {
        // A use nested in another macro argument cannot be proven preserved.
        if m.tokens.to_string().contains(MACRO_ARGUMENT_SENTINEL) {
            self.uncertain = true;
        }
    }
}
struct Analysis {
    sources: BTreeMap<String, String>,
    asts: BTreeMap<String, syn::File>,
    offsets: BTreeMap<String, usize>,
    crates: Vec<Krate>,
    roots: BTreeMap<String, usize>,
    modules: Vec<Module>,
    functions: Vec<Function>,
    nominal_parameters: BTreeMap<(usize, String), Parameters>,
    fields: BTreeMap<(usize, String, String), TypeHint>,
    struct_params: BTreeMap<(usize, String), Vec<String>>,
    struct_defaults: BTreeMap<(usize, String), Vec<Option<TypeHint>>>,
    enum_params: BTreeMap<(usize, String), Vec<String>>,
    variant_fields: BTreeMap<(usize, String, String), Vec<TypeHint>>,
    inherent_pending: Vec<InherentPending>,
    inherent: BTreeMap<(usize, String, String), Vec<Option<usize>>>,
    inherent_methods: BTreeMap<(usize, String, String), Vec<Option<usize>>>,
    inherent_returns: BTreeMap<(usize, String, String), Vec<TypeHint>>,
    wrap_pending: Vec<WrapPending>,
    wrap_targets: BTreeMap<(usize, String, String), Vec<TypeHint>>,
    macro_defs: BTreeMap<String, Vec<MacroDef>>,
    traits: Vec<TraitDecl>,
    trait_pending: Vec<TraitImplPending>,
    trait_impls: Vec<TraitImpl>,
    trait_impl_owners: Vec<TraitImplOwner>,
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
    fn preserves_single_expr(&self, rules: &[MacroRule], krate: usize) -> bool {
        !rules.is_empty()
            && rules.iter().all(|rule| {
                let Some(name) = single_expr_matcher(&rule.matcher) else {
                    return false;
                };
                if !metavariable_once(&rule.expansion, &name) {
                    return false;
                }
                let substituted = substitute_metavariable(&rule.expansion, &name);
                let Ok(block) = syn::parse2::<Block>(quote!({ #substituted })) else {
                    return false;
                };
                let mut scan = PreserveScan {
                    analysis: self,
                    krate,
                    count: 0,
                    uncertain: false,
                };
                scan.visit_block(&block);
                scan.count == 1 && !scan.uncertain
            })
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
            signature: signature_scope(&f.sig),
            self_type: None,
            self_args: None,
            default_method: None,
            macro_expanded: false,
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
        declared_at: usize,
        macro_use: bool,
    ) -> usize {
        let id = self.modules.len();
        self.selected.insert(file.clone());
        self.modules.push(Module {
            krate,
            parent,
            file: file.clone(),
            path: mod_path.clone(),
            state,
            declared_at,
            macro_use,
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
                        let declared_at =
                            self.point(&file, self.bytes(&file, m.mod_token.span).0).0;
                        let macro_use = m.attrs.iter().any(|a| a.path().is_ident("macro_use"));
                        let child = self.module(
                            krate,
                            Some(id),
                            file.clone(),
                            child_path,
                            join(&mod_dir, &name),
                            items,
                            selected,
                            declared_at,
                            macro_use,
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
                                let declared_at =
                                    self.point(&file, self.bytes(&file, m.mod_token.span).0).0;
                                let macro_use =
                                    m.attrs.iter().any(|a| a.path().is_ident("macro_use"));
                                let child = self.module(
                                    krate,
                                    Some(id),
                                    child_file.clone(),
                                    child_path,
                                    child_dir,
                                    ast.items,
                                    selected,
                                    declared_at,
                                    macro_use,
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
                Item::Trait(s) => {
                    let name = s.ident.to_string();
                    let (line, column) = self.point(&file, self.bytes(&file, s.ident.span()).0);
                    let qualname = if mod_path.is_empty() {
                        name.clone()
                    } else {
                        format!("{mod_path}::{name}")
                    };
                    let trait_generics: Vec<String> = s
                        .generics
                        .type_params()
                        .map(|param| param.ident.to_string())
                        .collect();
                    let trait_generic_set: BTreeSet<String> =
                        trait_generics.iter().cloned().collect();
                    let mut methods = BTreeMap::new();
                    let mut returns = BTreeMap::new();
                    let mut default_functions = Vec::new();
                    for item in &s.items {
                        if let TraitItem::Fn(m) = item {
                            let method_state = and(selected, self.attrs(&m.attrs, krate));
                            if method_state < 0 {
                                continue;
                            }
                            let method_name = m.sig.ident.to_string();
                            let (mline, mcolumn) =
                                self.point(&file, self.bytes(&file, m.sig.ident.span()).0);
                            methods.insert(
                                method_name.clone(),
                                TraitMethod {
                                    file: file.clone(),
                                    name: method_name.clone(),
                                    line: mline,
                                    column: mcolumn,
                                    qualname: format!("{qualname}::{method_name}"),
                                },
                            );
                            if let Some(hint) =
                                return_hint(&m.sig.output, &trait_generic_set)
                            {
                                returns.insert(method_name.clone(), hint);
                            }
                            // A default body is one source body regardless of how many
                            // types implement the trait. Register it once for scanning;
                            // impls never duplicate this body.
                            if m.default.is_some() {
                                let item = ItemFn {
                                    attrs: m.attrs.clone(),
                                    vis: Visibility::Inherited,
                                    sig: m.sig.clone(),
                                    block: Box::new(m.default.clone().unwrap()),
                                };
                                let index = self.register_fn(
                                    id,
                                    &file,
                                    &item,
                                    format!("{qualname}::{method_name}"),
                                    method_state,
                                );
                                self.functions[index].default_method = Some(DefaultMethod {
                                    file: file.clone(),
                                    name: method_name.clone(),
                                    qualname: format!("{qualname}::{method_name}"),
                                    line: mline,
                                    column: mcolumn,
                                    trait_name: name.clone(),
                                    trait_index: None,
                                });
                                default_functions.push(index);
                                for param in s.generics.type_params() {
                                    let generic = param.ident.to_string();
                                    self.functions[index].generics.push(generic.clone());
                                    for bound in &param.bounds {
                                        if let TypeParamBound::Trait(b) = bound {
                                            self.functions[index]
                                                .signature
                                                .generic_bounds
                                                .entry(generic.clone())
                                                .or_default()
                                                .push((
                                                    path_parts(&b.path),
                                                    b.path.leading_colon.is_some(),
                                                ));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    let index = self.traits.len();
                    self.traits.push(TraitDecl {
                        file: file.clone(),
                        name: name.clone(),
                        qualname,
                        line,
                        column,
                        generics: trait_generics,
                        methods,
                        returns,
                    });
                    for function in default_functions {
                        if let Some(method) = self.functions[function].default_method.as_mut() {
                            method.trait_index = Some(index);
                        }
                    }
                    self.add_binding(id, name, Binding::Trait(index));
                }
                Item::Union(s) => self.add_binding(id, s.ident.to_string(), Binding::Other),
                Item::Struct(s) => {
                    let name = s.ident.to_string();
                    let ordered: Vec<String> = s
                        .generics
                        .type_params()
                        .map(|p| p.ident.to_string())
                        .collect();
                    let struct_generics: BTreeSet<String> = ordered.iter().cloned().collect();
                    self.struct_params
                        .insert((id, name.clone()), ordered);
                    self.struct_defaults.insert(
                        (id, name.clone()),
                        s.generics
                            .type_params()
                            .map(|param| {
                                param
                                    .default
                                    .as_ref()
                                    .and_then(|ty| type_hint(ty, &struct_generics))
                            })
                            .collect(),
                    );
                    for field in &s.fields {
                        if let Some(ident) = &field.ident {
                            if let Some(hint) = type_hint(&field.ty, &struct_generics) {
                                self.fields
                                    .insert((id, name.clone(), ident.to_string()), hint);
                            }
                        }
                    }
                    let parameters = declaration_parameters(&s.generics, true);
                    let binding = if selected != 1 {
                        Binding::Other
                    } else if parameters != Parameters::Unsupported {
                        if parameters != Parameters::None {
                            self.nominal_parameters
                                .insert((id, name.clone()), parameters);
                        }
                        Binding::Nominal(id, name.clone())
                    } else {
                        Binding::Fields(id, name.clone())
                    };
                    self.add_binding(id, name, binding);
                }
                Item::Enum(s) => {
                    let name = s.ident.to_string();
                    let enum_generics: Vec<String> = s
                        .generics
                        .type_params()
                        .map(|param| param.ident.to_string())
                        .collect();
                    let enum_generic_set: BTreeSet<String> =
                        enum_generics.iter().cloned().collect();
                    self.enum_params
                        .insert((id, name.clone()), enum_generics);
                    for variant in &s.variants {
                        // A tuple variant wins over a same-named inherent fn.
                        // Keep all variant names blocked, including unknown cfg.
                        self.variants
                            .insert((id, name.clone(), variant.ident.to_string()));
                        if let syn::Fields::Unnamed(fields) = &variant.fields {
                            let hints: Vec<Option<TypeHint>> = fields
                                .unnamed
                                .iter()
                                .map(|field| type_hint(&field.ty, &enum_generic_set))
                                .collect();
                            if !hints.is_empty() && hints.iter().all(Option::is_some) {
                                self.variant_fields.insert(
                                    (id, name.clone(), variant.ident.to_string()),
                                    hints.into_iter().flatten().collect(),
                                );
                            }
                        }
                    }
                    let parameters = declaration_parameters(&s.generics, false);
                    let binding = if selected != 1 {
                        Binding::Other
                    } else if parameters != Parameters::Unsupported {
                        if parameters != Parameters::None {
                            self.nominal_parameters
                                .insert((id, name.clone()), parameters);
                        }
                        Binding::Nominal(id, name.clone())
                    } else {
                        Binding::Fields(id, name.clone())
                    };
                    self.add_binding(id, name, binding);
                }
                Item::Type(s) => self.add_binding(id, s.ident.to_string(), Binding::Other),
                Item::Const(s) => self.add_binding(id, s.ident.to_string(), Binding::Other),
                Item::Static(s) => self.add_binding(id, s.ident.to_string(), Binding::Other),
                Item::Impl(im) => {
                    let owner = im.self_ty.to_token_stream().to_string();
                    let trait_ref = im
                        .trait_
                        .as_ref()
                        .map(|(_, path, _)| (path_parts(path), path.leading_colon.is_some()));
                    let self_path = match im.self_ty.as_ref() {
                        Type::Path(p) if p.qself.is_none() => {
                            Some((path_parts(&p.path), p.path.leading_colon.is_some()))
                        }
                        _ => None,
                    };
                    // Keep unsupported inherent declarations as competitors for
                    // generic owners. Ignoring them can select the wrong concrete impl.
                    let owner_path = if im.trait_.is_none() {
                        match im.self_ty.as_ref() {
                            Type::Path(p)
                                if p.qself.is_none()
                                    && p.path.leading_colon.is_none()
                                    && p.path
                                        .segments
                                        .iter()
                                        .take(p.path.segments.len().saturating_sub(1))
                                        .all(|s| matches!(s.arguments, PathArguments::None)) =>
                            {
                                let arguments = &p.path.segments.last().unwrap().arguments;
                                Some((path_parts(&p.path), inherent_parameters(&im, arguments)))
                            }
                            _ => None,
                        }
                    } else {
                        None
                    };
                    let im_generics = im.generics.clone();
                    let impl_types: Vec<String> = im_generics
                        .type_params()
                        .map(|p| p.ident.to_string())
                        .collect();
                    let impl_generics: BTreeSet<String> =
                        impl_types.iter().cloned().collect();
                    let (impl_items, macro_expanded) =
                        match self.expanded_impl_items(krate, id, &file, &im.items) {
                            Some(items) => (items, true),
                            None => (im.items.iter().cloned().collect(), false),
                        };
                    let mut impl_methods = BTreeSet::new();
                    let mut impl_complete = selected == 1;
                    if let Some((trait_path, absolute)) = &trait_ref {
                        let mut args = Vec::new();
                        if let Some(segment) =
                            im.trait_.as_ref().and_then(|(_, path, _)| path.segments.last())
                        {
                            if let PathArguments::AngleBracketed(list) = &segment.arguments {
                                for arg in &list.args {
                                    if let GenericArgument::Type(ty) = arg {
                                        if let Some(hint) = type_hint(ty, &impl_generics) {
                                            args.push(hint);
                                        }
                                    }
                                }
                            }
                        }
                        let associated = im.items.iter().find_map(|item| match item {
                            ImplItem::Type(ty) if ty.ident == "Target" => {
                                type_hint(&ty.ty, &impl_generics)
                            }
                            _ => None,
                        });
                        for item in &impl_items {
                            let ImplItem::Fn(f) = item else {
                                continue;
                            };
                            let method = f.sig.ident.to_string();
                            if !["as_ref", "borrow", "deref"].contains(&method.as_str()) {
                                continue;
                            }
                            self.wrap_pending.push(WrapPending {
                                module: id,
                                self_path: self_path.clone(),
                                trait_path: trait_path.clone(),
                                absolute: *absolute,
                                method,
                                args: args.clone(),
                                associated: associated.clone(),
                            });
                        }
                    }
                    for i in impl_items {
                        if let ImplItem::Fn(f) = i {
                            let item = ItemFn {
                                attrs: f.attrs.clone(),
                                vis: f.vis.clone(),
                                sig: f.sig.clone(),
                                block: Box::new(f.block),
                            };
                            let cfg = and(selected, self.attrs(&item.attrs, krate));
                            if cfg == 0 {
                                impl_complete = false;
                            }
                            if cfg == 1 {
                                impl_methods.insert(item.sig.ident.to_string());
                            }
                            if cfg >= 0 {
                                let index = self.register_fn(
                                    id,
                                    &file,
                                    &item,
                                    format!("{mod_path}::{owner}::{}", item.sig.ident),
                                    cfg,
                                );
                                self.functions[index].generics.extend(impl_types.clone());
                                self.functions[index].macro_expanded = macro_expanded;
                                self.functions[index].self_type =
                                    type_hint(&im.self_ty, &impl_generics);
                                let mut self_args = Vec::new();
                                if let syn::Type::Path(p) = im.self_ty.as_ref() {
                                    if let Some(segment) = p.path.segments.last() {
                                        if let PathArguments::AngleBracketed(args) = &segment.arguments {
                                            for arg in &args.args {
                                                if let GenericArgument::Type(ty) = arg {
                                                    if let Some(hint) = type_hint(ty, &impl_generics) {
                                                        self_args.push(hint);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                self.functions[index].self_args = Some(self_args);
                                let mut method_generics = impl_generics.clone();
                                method_generics.extend(
                                    item.sig
                                        .generics
                                        .type_params()
                                        .map(|param| param.ident.to_string()),
                                );
                                let returns = return_hint(&item.sig.output, &method_generics);
                                for param in im_generics.type_params() {
                                    let name = param.ident.to_string();
                                    for bound in &param.bounds {
                                        if let TypeParamBound::Trait(b) = bound {
                                            self.functions[index]
                                                .signature
                                                .generic_bounds
                                                .entry(name.clone())
                                                .or_default()
                                                .push((
                                                    path_parts(&b.path),
                                                    b.path.leading_colon.is_some(),
                                                ));
                                        }
                                    }
                                }
                                if let Some(clause) = &im_generics.where_clause {
                                    for predicate in &clause.predicates {
                                        let WherePredicate::Type(predicate) = predicate else {
                                            continue;
                                        };
                                        let Type::Path(bounded) = &predicate.bounded_ty else {
                                            continue;
                                        };
                                        if bounded.qself.is_some()
                                            || bounded.path.segments.len() != 1
                                        {
                                            continue;
                                        }
                                        let name =
                                            bounded.path.segments[0].ident.to_string();
                                        for bound in &predicate.bounds {
                                            if let TypeParamBound::Trait(b) = bound {
                                                self.functions[index]
                                                    .signature
                                                    .generic_bounds
                                                    .entry(name.clone())
                                                    .or_default()
                                                    .push((
                                                        path_parts(&b.path),
                                                        b.path.leading_colon.is_some(),
                                                    ));
                                            }
                                        }
                                    }
                                }
                                if let Some((path, parameters)) = &owner_path {
                                    self.inherent_pending.push(InherentPending {
                                        module: id,
                                        owner: path.clone(),
                                        name: item.sig.ident.to_string(),
                                        index,
                                        parameters: *parameters,
                                        static_function: item.sig.receiver().is_none(),
                                        returns,
                                    });
                                }
                                if let Some((trait_path, absolute)) = &trait_ref {
                                    self.trait_pending.push(TraitImplPending {
                                        module: id,
                                        trait_path: trait_path.clone(),
                                        absolute: *absolute,
                                        self_path: self_path
                                            .as_ref()
                                            .map(|(parts, absolute)| (parts.clone(), *absolute)),
                                        self_type: owner.clone(),
                                        method: item.sig.ident.to_string(),
                                        function: index,
                                        state: cfg,
                                    });
                                }
                            }
                        }
                    }
                    if selected == 1 {
                        if let Some((trait_path, absolute)) = &trait_ref {
                            let plain = im_generics.params.is_empty()
                                && im_generics.where_clause.is_none()
                                && matches!(im.self_ty.as_ref(), Type::Path(path)
                                    if path.qself.is_none()
                                        && path.path.segments.iter().all(|segment| matches!(segment.arguments, PathArguments::None)));
                            self.trait_impl_owners.push(TraitImplOwner {
                                module: id,
                                trait_path: trait_path.clone(),
                                absolute: *absolute,
                                self_path: self_path.clone(),
                                has_methods: impl_methods,
                                complete: impl_complete,
                                plain,
                            });
                        }
                    }
                }
                Item::Macro(m) => {
                    if m.mac.path.is_ident("macro_rules") {
                        let state = and(selected, self.attrs(&m.attrs, krate));
                        if state == 1 {
                            if let Some(name_ident) = &m.ident {
                                if let Ok(def) =
                                    syn::parse2::<ParsedMacroDef>(m.mac.tokens.clone())
                                {
                                    let name = name_ident.to_string();
                                    let (line, column) =
                                        self.point(&file, self.bytes(&file, name_ident.span()).0);
                                    let preserves = self.preserves_single_expr(&def.rules, krate);
                                    self.macro_defs.entry(name.clone()).or_default().push(
                                        MacroDef {
                                            name,
                                            file: file.clone(),
                                            line,
                                            column,
                                            module: id,
                                            krate,
                                            preserves,
                                            rules: def.rules,
                                        },
                                    );
                                }
                            }
                        }
                    }
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
    fn preserving_macro(&self, krate: usize, module: usize, line: usize, m: &Macro) -> Option<MacroDef> {
        if m.path.segments.len() != 1 {
            return None;
        }
        let name = m.path.segments[0].ident.to_string();
        let defs = self.macro_defs.get(&name)?;
        if defs.len() != 1 {
            return None;
        }
        let def = &defs[0];
        if def.krate != krate || !def.preserves || !self.macro_visible(def, module, line) {
            return None;
        }
        Some(def.clone())
    }

    // A zero-argument local macro used as the whole body of an impl is a
    // textual method template. Expanding it here keeps generated forwarding
    // methods visible without claiming general macro expansion.
    fn expanded_impl_items(
        &self,
        krate: usize,
        module: usize,
        file: &str,
        items: &[ImplItem],
    ) -> Option<Vec<ImplItem>> {
        let mut iter = items.iter();
        let ImplItem::Macro(invocation) = iter.next()? else {
            return None;
        };
        if iter.next().is_some()
            || !invocation.mac.tokens.is_empty()
            || invocation.mac.path.segments.len() != 1
        {
            return None;
        }
        let name = invocation.mac.path.segments[0].ident.to_string();
        let (line, _) =
            self.point(file, self.bytes(file, invocation.mac.path.span()).0);
        let defs = self.macro_defs.get(&name)?;
        let mut visible: Vec<&MacroDef> = defs
            .iter()
            .filter(|def| {
                def.krate == krate
                    && def.file == file
                    && def.module == module
                    && self.macro_visible(def, module, line)
            })
            .collect();
        if visible.len() != 1 {
            return None;
        }
        let def = visible.pop()?;
        if def.rules.len() != 1 || !def.rules[0].matcher.is_empty() {
            return None;
        }
        let expanded = syn::parse2::<ImplItems>(def.rules[0].expansion.clone()).ok()?;
        Some(expanded.0)
    }

    fn ancestor_child(&self, ancestor: usize, module: usize) -> Option<usize> {
        let mut current = module;
        loop {
            if current == ancestor {
                return None;
            }
            match self.modules[current].parent {
                Some(parent) if parent == ancestor => return Some(current),
                Some(parent) => current = parent,
                None => return None,
            }
        }
    }

    // macro_rules! names are textual. Only follow a definition that the callsite
    // can see without an import that might bind the same name to something else.
    fn macro_visible(&self, def: &MacroDef, module: usize, line: usize) -> bool {
        let name = &def.name;
        let same_or_ancestor = def.module == module || self.ancestor_child(def.module, module).is_some();
        let scope = if same_or_ancestor {
            def.module
        } else {
            match self.modules[def.module].parent {
                Some(parent) => parent,
                None => return false,
            }
        };
        let mut current = Some(module);
        let mut inside_scope = false;
        while let Some(id) = current {
            let visible = &self.modules[id];
            if visible.use_lines.contains_key(name)
                || visible.uncertain_glob
                || !visible.globs.is_empty()
            {
                return false;
            }
            if id == scope {
                inside_scope = true;
                break;
            }
            current = visible.parent;
        }
        if !inside_scope {
            return false;
        }
        if def.module == module {
            return def.line < line;
        }
        if let Some(child) = self.ancestor_child(def.module, module) {
            return self.modules[child].declared_at > def.line;
        }
        // A sibling module only contributes its macros through #[macro_use],
        // inserted at the point its `mod` item appears.
        if !self.modules[def.module].macro_use {
            return false;
        }
        match self.ancestor_child(scope, module) {
            Some(child) => self.modules[child].declared_at > self.modules[def.module].declared_at,
            None => false,
        }
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
    // Name-based AsRef/Borrow/Deref behavior is only safe when the trait is the
    // standard-library contract. Resolved local traits use their declaration.
    fn std_accessor_name(&self, module: usize, parts: &[String]) -> Option<String> {
        let known = |name: &str| matches!(name, "AsRef" | "Borrow" | "Deref");
        let mut effective = parts;
        let mut prelude = false;
        if parts.len() == 1 {
            match self.modules[module].bindings.get(&parts[0]) {
                Some(bindings) if bindings.len() == 1 => match &bindings[0] {
                    Binding::Use(target, _) => effective = target.as_slice(),
                    _ => return None,
                },
                Some(_) => return None,
                None => prelude = true,
            }
        }
        let name = effective.last()?;
        if !known(name) {
            return None;
        }
        let trusted = matches!(
            effective.first().map(String::as_str),
            Some("std") | Some("core") | Some("alloc")
        );
        (trusted || (prelude && effective.len() == 1)).then(|| name.clone())
    }
    // Box/Arc/Rc in the standard library return their sole type argument from
    // as_ref/deref/borrow. The rule only applies when no local type resolves.
    fn std_pointer_target(
        &self,
        module: usize,
        parts: &[String],
        method: &str,
        args: &[TypeHint],
    ) -> Option<TypeHint> {
        if !["as_ref", "deref", "borrow"].contains(&method) || args.len() != 1 {
            return None;
        }
        let name = parts.last()?;
        if !["Box", "Arc", "Rc"].contains(&name.as_str()) {
            return None;
        }
        let trusted = if parts.len() > 1 {
            matches!(parts[0].as_str(), "std" | "core" | "alloc")
        } else {
            match self.modules[module].bindings.get(name) {
                Some(bindings) if bindings.len() == 1 => match &bindings[0] {
                    Binding::Use(target, _) => target.iter().any(|part| {
                        matches!(part.as_str(), "std" | "core" | "alloc" | "stdlib")
                    }),
                    _ => false,
                },
                Some(_) => false,
                None => true,
            }
        };
        trusted.then(|| args[0].clone())
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
                    let parameters = self.nominal_parameters.get(&(m, name.clone()));
                    let key = (m, name, part.clone());
                    if self.variants.contains(&key) {
                        return None;
                    }
                    let candidates = self.inherent.get(&key)?;
                    if candidates.len() != 1 {
                        return None;
                    }
                    let index = *candidates[0].as_ref()?;
                    match parameters {
                        Some(Parameters::Types(_)) => Binding::SpecializedInherent(index),
                        Some(Parameters::Lifetimes(_)) => Binding::LifetimeInherent(index),
                        _ => Binding::Inherent(index),
                    }
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

#[derive(Clone)]
enum TypeHint {
    Generic(String),
    Dyn(Vec<String>, bool),
    Nominal(Vec<String>, bool),
}
#[derive(Clone, Default)]
struct Scope {
    uncertain_glob: bool,
    values: BTreeSet<String>,
    types: BTreeSet<String>,
    uses: BTreeMap<String, (Vec<String>, bool)>,
    globs: Vec<Vec<String>>,
    local_types: BTreeMap<String, TypeHint>,
    generic_bounds: BTreeMap<String, Vec<(Vec<String>, bool)>>,
    macros: BTreeMap<String, Vec<MacroDef>>,
}
fn type_hint(ty: &Type, generics: &BTreeSet<String>) -> Option<TypeHint> {
    match ty {
        Type::Reference(r) => type_hint(&r.elem, generics),
        Type::Paren(p) => type_hint(&p.elem, generics),
        Type::Group(g) => type_hint(&g.elem, generics),
        Type::TraitObject(t) => {
            for bound in &t.bounds {
                if let TypeParamBound::Trait(b) = bound {
                    return Some(TypeHint::Dyn(
                        path_parts(&b.path),
                        b.path.leading_colon.is_some(),
                    ));
                }
            }
            None
        }
        Type::Path(p) if p.qself.is_none() => {
            for segment in &p.path.segments {
                if let PathArguments::AngleBracketed(args) = &segment.arguments {
                    for arg in &args.args {
                        if let GenericArgument::Type(inner) = arg {
                            if let Some(hint @ TypeHint::Dyn(_, _)) = type_hint(inner, generics) {
                                return Some(hint);
                            }
                        }
                    }
                }
            }
            let parts = path_parts(&p.path);
            if parts.len() == 1 && generics.contains(&parts[0]) {
                return Some(TypeHint::Generic(parts[0].clone()));
            }
            Some(TypeHint::Nominal(parts, p.path.leading_colon.is_some()))
        }
        _ => None,
    }
}
fn return_hint(output: &ReturnType, generics: &BTreeSet<String>) -> Option<TypeHint> {
    match output {
        ReturnType::Type(_, ty) => type_hint(ty, generics),
        ReturnType::Default => None,
    }
}
fn hint_key(hint: &TypeHint) -> String {
    match hint {
        TypeHint::Generic(name) => format!("generic:{name}"),
        TypeHint::Dyn(parts, absolute) => format!("dyn:{}:{}", absolute, parts.join("::")),
        TypeHint::Nominal(parts, absolute) => {
            format!("nominal:{}:{}", absolute, parts.join("::"))
        }
    }
}
fn unique_hint(values: &[TypeHint]) -> Option<TypeHint> {
    let first = values.first()?;
    let key = hint_key(first);
    values
        .iter()
        .all(|value| hint_key(value) == key)
        .then(|| first.clone())
}
fn unique_index(values: &[Option<usize>]) -> Option<usize> {
    if values.iter().any(Option::is_none) {
        return None;
    }
    let set: BTreeSet<usize> = values.iter().flatten().copied().collect();
    (set.len() == 1).then(|| *set.first().unwrap())
}
// Substitutes a declared return type with an impl's trait arguments. Any
// unresolved generic outside the supplied parameters fails closed rather than
// keeping a type name that could match an unrelated local item.
fn substitute_hint(hint: &TypeHint, params: &[String], args: &[TypeHint]) -> Option<TypeHint> {
    match hint {
        TypeHint::Generic(name) => {
            let position = params.iter().position(|param| param == name)?;
            args.get(position).cloned()
        }
        TypeHint::Dyn(parts, absolute) => {
            if parts.iter().any(|part| params.contains(part)) {
                None
            } else {
                Some(TypeHint::Dyn(parts.clone(), *absolute))
            }
        }
        TypeHint::Nominal(parts, absolute) => {
            let Some(position) = params.iter().position(|param| param == &parts[0]) else {
                return if parts.iter().any(|part| params.contains(part)) {
                    None
                } else {
                    Some(hint.clone())
                };
            };
            let argument = args.get(position)?;
            if parts.len() == 1 {
                return Some(argument.clone());
            }
            match argument {
                TypeHint::Nominal(head, _) => {
                    let mut joined = head.clone();
                    joined.extend_from_slice(&parts[1..]);
                    Some(TypeHint::Nominal(joined, *absolute))
                }
                _ => None,
            }
        }
    }
}
fn type_hint_from_expr(expr: &Expr) -> Option<TypeHint> {    match expr {
        Expr::Reference(r) => type_hint_from_expr(&r.expr),
        Expr::Paren(p) => type_hint_from_expr(&p.expr),
        Expr::Struct(s) => Some(TypeHint::Nominal(
            path_parts(&s.path),
            s.path.leading_colon.is_some(),
        )),
        Expr::Call(c) => {
            let Expr::Path(p) = c.func.as_ref() else {
                return None;
            };
            if p.qself.is_some() || p.path.segments.len() < 2 {
                return None;
            }
            let mut parts = path_parts(&p.path);
            parts.pop();
            Some(TypeHint::Nominal(parts, p.path.leading_colon.is_some()))
        }
        _ => None,
    }
}
fn builtin_variant(name: &str, variant: &str) -> Option<(Vec<String>, Vec<TypeHint>)> {
    match (name, variant) {
        ("Option", "Some") => Some((
            vec!["T".into()],
            vec![TypeHint::Generic("T".into())],
        )),
        ("Result", "Ok") => Some((
            vec!["T".into(), "E".into()],
            vec![TypeHint::Generic("T".into())],
        )),
        ("Result", "Err") => Some((
            vec!["T".into(), "E".into()],
            vec![TypeHint::Generic("E".into())],
        )),
        _ => None,
    }
}
fn signature_scope(sig: &Signature) -> Scope {
    let mut scope = Scope::default();
    let generics: BTreeSet<String> = sig
        .generics
        .type_params()
        .map(|p| p.ident.to_string())
        .collect();
    scope.types.extend(generics.iter().cloned());
    for param in sig.generics.type_params() {
        for bound in &param.bounds {
            if let TypeParamBound::Trait(b) = bound {
                scope
                    .generic_bounds
                    .entry(param.ident.to_string())
                    .or_default()
                    .push((path_parts(&b.path), b.path.leading_colon.is_some()));
            }
        }
    }
    if let Some(where_clause) = &sig.generics.where_clause {
        for predicate in &where_clause.predicates {
            if let WherePredicate::Type(p) = predicate {
                if let Type::Path(t) = &p.bounded_ty {
                    if t.qself.is_none() && t.path.segments.len() == 1 {
                        let name = t.path.segments[0].ident.to_string();
                        for bound in &p.bounds {
                            if let TypeParamBound::Trait(b) = bound {
                                scope
                                    .generic_bounds
                                    .entry(name.clone())
                                    .or_default()
                                    .push((path_parts(&b.path), b.path.leading_colon.is_some()));
                            }
                        }
                    }
                }
            }
        }
    }
    for arg in &sig.inputs {
        if let FnArg::Typed(p) = arg {
            let mut names = Vec::new();
            pattern_names(&p.pat, &mut names);
            scope.values.extend(names.iter().cloned());
            if let Some(hint) = type_hint(&p.ty, &generics) {
                for name in names {
                    scope.local_types.insert(name, hint.clone());
                }
            }
        }
    }
    scope
}
#[derive(Clone)]
struct Caller {
    file: String,
    name: String,
    qualname: String,
    kind: &'static str,
    line: usize,
    column: usize,
}
fn self_deref_depth(expr: &Expr) -> Option<usize> {
    match expr {
        Expr::Path(path) if path.qself.is_none() && path.path.is_ident("self") => Some(0),
        Expr::Paren(paren) => self_deref_depth(&paren.expr),
        Expr::Unary(unary) if matches!(unary.op, UnOp::Deref(_)) => {
            self_deref_depth(&unary.expr).map(|depth| depth + 1)
        }
        _ => None,
    }
}
struct Scanner<'a> {
    a: &'a mut Analysis,
    function: Function,
    callers: Vec<Caller>,
    scopes: Vec<Scope>,
    state: State,
    macro_evidence: Vec<Value>,
}
impl Scanner<'_> {
    fn excluded(&mut self, span: Span) {
        let file = &self.function.file;
        let (start, end) = self.a.bytes(file, span);
        self.a.excluded_regions.push(json!({"file":file,"range":self.a.range(file,start,end),"reason":"cfg-or-test-not-selected"}));
    }
    fn annotate_default(&self, record: &mut Value) {
        if let Some(method) = &self.function.default_method {
            record["defaultMethod"] = json!({
                "file": method.file,
                "name": method.name,
                "qualname": method.qualname,
                "line": method.line,
                "column": method.column,
                "trait": method.trait_name,
            });
        }
    }
    fn annotate_caller(&self, record: &mut Value) {
        if let Some(c) = self.callers.last() {
            record["directCaller"] = json!({
                "file": c.file,
                "name": c.name,
                "qualname": c.qualname,
                "kind": c.kind,
                "line": c.line,
                "column": c.column,
            });
        }
    }
    fn caller_at(&self, span: Span, name: &str, qualname: String, kind: &'static str) -> Caller {
        let file = self.function.file.clone();
        let start = self.a.bytes(&file, span).0;
        let (line, column) = self.a.point(&file, start);
        Caller { file, name: name.into(), qualname, kind, line, column }
    }
    fn annotate_context(&self, record: &mut Value) {
        // Distinct crate contexts at one physical call must agree before navigation.
        record["_crate"] =
            json!(self.a.crates[self.a.modules[self.function.module].krate].id);
        self.annotate_default(record);
        self.annotate_caller(record);
        if !self.macro_evidence.is_empty() {
            record["macroEvidence"] = Value::Array(self.macro_evidence.clone());
        }
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
                Some(Binding::SpecializedInherent(index))
                    if p.path
                        .segments
                        .iter()
                        .all(|s| matches!(s.arguments, PathArguments::None)) =>
                {
                    Some((index, "rust-specialized-inherent-source-candidate"))
                }
                Some(Binding::LifetimeInherent(index))
                    if p.path
                        .segments
                        .iter()
                        .all(|s| matches!(s.arguments, PathArguments::None)) =>
                {
                    Some((index, "rust-lifetime-inherent-source-candidate"))
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
        self.annotate_context(&mut r);
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
    fn resolve_trait(&self, parts: &[String], absolute: bool) -> Option<usize> {
        if parts.is_empty() {
            return None;
        }
        if !["crate", "self", "super"].contains(&parts[0].as_str()) {
            for scope in self.scopes.iter().rev() {
                if let Some((prefix, abs)) = scope.uses.get(&parts[0]) {
                    let mut full = prefix.clone();
                    full.extend_from_slice(&parts[1..]);
                    return match self.a.resolve(self.function.module, &full, *abs, true, 0) {
                        Some(Binding::Trait(index)) => Some(index),
                        _ => None,
                    };
                }
            }
        }
        match self
            .a
            .resolve(self.function.module, parts, absolute, false, 0)
        {
            Some(Binding::Trait(index)) => Some(index),
            _ => None,
        }
    }
    fn resolve_nominal(&self, parts: &[String], absolute: bool) -> Option<(usize, String)> {
        if parts.is_empty() {
            return None;
        }
        if !["crate", "self", "super"].contains(&parts[0].as_str()) {
            for scope in self.scopes.iter().rev() {
                if let Some((prefix, abs)) = scope.uses.get(&parts[0]) {
                    let mut full = prefix.clone();
                    full.extend_from_slice(&parts[1..]);
                    return match self.a.resolve(self.function.module, &full, *abs, true, 0) {
                        Some(Binding::Nominal(module, name))
                        | Some(Binding::Fields(module, name)) => Some((module, name)),
                        _ => None,
                    };
                }
            }
        }
        match self
            .a
            .resolve(self.function.module, parts, absolute, false, 0)
        {
            Some(Binding::Nominal(module, name))
            | Some(Binding::Fields(module, name)) => Some((module, name)),
            _ => None,
        }
    }
    fn bound_trait(&self, generic: &str, method: &str) -> Option<usize> {
        for scope in self.scopes.iter().rev() {
            let Some(bounds) = scope.generic_bounds.get(generic) else {
                continue;
            };
            let mut found = Vec::new();
            for (parts, absolute) in bounds {
                if let Some(decl) = self.resolve_trait(parts, *absolute) {
                    if self.a.traits[decl].methods.contains_key(method) {
                        found.push(decl)
                    }
                }
            }
            return match found.len() {
                1 => found.pop(),
                _ => None,
            };
        }
        None
    }
    fn local_hint(&self, name: &str) -> Option<TypeHint> {
        for scope in self.scopes.iter().rev() {
            if let Some(hint) = scope.local_types.get(name) {
                return Some(hint.clone());
            }
        }
        None
    }
    fn accessor_return(&self, module: usize, name: String, method: &str) -> Option<TypeHint> {
        if self
            .a
            .inherent_methods
            .contains_key(&(module, name.clone(), method.to_string()))
            || self
                .a
                .inherent_returns
                .contains_key(&(module, name.clone(), method.to_string()))
        {
            return self
                .a
                .inherent_returns
                .get(&(module, name, method.to_string()))
                .and_then(|values| unique_hint(values));
        }
        self.a
            .wrap_targets
            .get(&(module, name, method.to_string()))
            .and_then(|values| unique_hint(values))
    }
    fn variant_owner(
        &self,
        path: &syn::Path,
        parts: &[String],
        absolute: bool,
    ) -> Option<(usize, String, String)> {
        let variant = path.segments.last()?.ident.to_string();
        if path.segments.len() == 1 {
            let (module, name) = self.resolve_nominal(parts, absolute)?;
            return Some((module, name, variant));
        }
        let mut owner = path_parts(path);
        owner.pop();
        let (module, name) = self.resolve_nominal(&owner, path.leading_colon.is_some())?;
        Some((module, name, variant))
    }
    fn receiver_hint(&self, expr: &Expr) -> Option<TypeHint> {
        match expr {
            Expr::Path(p) if p.qself.is_none() && p.path.segments.len() == 1 => {
                self.local_hint(&p.path.segments[0].ident.to_string())
            }
            Expr::Reference(r) => self.receiver_hint(&r.expr),
            Expr::Paren(p) => self.receiver_hint(&p.expr),
            Expr::Unary(unary) if matches!(unary.op, UnOp::Deref(_)) => {
                let depth = self_deref_depth(&unary.expr)? + 1;
                if depth > 2 {
                    return None;
                }
                let hint = self.function.self_type.clone()?;
                if depth <= 1 {
                    Some(hint)
                } else {
                    match hint {
                        TypeHint::Generic(_) => Some(hint),
                        TypeHint::Nominal(parts, _)
                            if parts.len() == 1 && parts[0] == "Box" =>
                        {
                            self.function.self_args.as_ref()?.first().cloned()
                        }
                        _ => None,
                    }
                }
            }
            Expr::Field(f) => {
                let TypeHint::Nominal(parts, absolute) = self.receiver_hint(&f.base)? else {
                    return None;
                };
                let (module, name) = self.resolve_nominal(&parts, absolute)?;
                let member = match &f.member {
                    syn::Member::Named(ident) => ident.to_string(),
                    syn::Member::Unnamed(index) => index.index.to_string(),
                };
                match self.a.fields.get(&(module, name.clone(), member)).cloned()? {
                    // Substitute the struct parameter position with the impl's self argument.
                    TypeHint::Generic(parameter) => {
                        let params = self.a.struct_params.get(&(module, name.clone()))?;
                        let position = params.iter().position(|param| param == &parameter)?;
                        let TypeHint::Nominal(parts, absolute) =
                            self.function.self_type.clone()?
                        else {
                            return None;
                        };
                        if self.resolve_nominal(&parts, absolute)? != (module, name.clone()) {
                            return None;
                        }
                        let mut args = self.function.self_args.clone()?;
                        if args.len() > params.len() {
                            return None;
                        }
                        // A default type parameter such as `Layered<L, I, S = I>`
                        // still binds the omitted positions of `Layered<L, S>`.
                        let defaults = self
                            .a
                            .struct_defaults
                            .get(&(module, name.clone()))?;
                        for index in args.len()..params.len() {
                            let default = defaults.get(index)?.clone()?;
                            let resolved =
                                substitute_hint(&default, &params[..index], &args)?;
                            args.push(resolved);
                        }
                        args.get(position).cloned()
                    }
                    hint => Some(hint),
                }
            }
            Expr::Struct(s) => Some(TypeHint::Nominal(
                path_parts(&s.path),
                s.path.leading_colon.is_some(),
            )),
            Expr::Call(c) => {
                let Expr::Path(p) = c.func.as_ref() else {
                    return None;
                };
                if p.qself.is_some() || p.path.segments.is_empty() {
                    return None;
                }
                let mut parts = path_parts(&p.path);
                parts.pop();
                Some(TypeHint::Nominal(parts, p.path.leading_colon.is_some()))
            }
            Expr::MethodCall(m) => {
                let method = m.method.to_string();
                if !["as_ref", "deref", "borrow"].contains(&method.as_str()) {
                    return None;
                }
                let is_self = matches!(
                    m.receiver.as_ref(),
                    Expr::Path(p)
                        if p.qself.is_none()
                            && p.path.segments.len() == 1
                            && p.path.segments[0].ident == "self"
                );
                let (module, name) = if is_self {
                    let TypeHint::Nominal(parts, absolute) = self.function.self_type.clone()?
                    else {
                        return None;
                    };
                    match self.resolve_nominal(&parts, absolute) {
                        Some(resolved) => resolved,
                        None => {
                            return self.a.std_pointer_target(
                                self.function.module,
                                &parts,
                                &method,
                                self.function.self_args.as_deref()?,
                            );
                        }
                    }
                } else {
                    let TypeHint::Nominal(parts, absolute) =
                        self.receiver_hint(&m.receiver)?
                    else {
                        return None;
                    };
                    self.resolve_nominal(&parts, absolute)?
                };
                self.accessor_return(module, name, &method)
            }
            _ => None,
        }
    }
    fn unique_trait_impl(&self, module: usize, name: &str, method: &str) -> Option<usize> {
        if self
            .a
            .inherent
            .contains_key(&(module, name.to_string(), method.to_string()))
        {
            return None;
        }
        let mut functions = BTreeSet::new();
        for edge in &self.a.trait_impls {
            if edge.state == 1
                && edge.self_module == Some(module)
                && edge.self_name.as_deref() == Some(name)
                && edge.method == method
            {
                functions.insert(edge.function);
            }
        }
        if functions.len() == 1 {
            functions.pop_first()
        } else {
            None
        }
    }
    fn inherited_trait_default(&self, module: usize, name: &str, method: &str) -> Option<usize> {
        let mut found = Vec::new();
        for owner in &self.a.trait_impl_owners {
            if !owner.plain || !owner.complete || owner.has_methods.contains(method) {
                continue;
            }
            let Some((parts, absolute)) = &owner.self_path else {
                continue;
            };
            let resolved = match self.a.resolve(owner.module, parts, *absolute, false, 0) {
                Some(Binding::Nominal(target_module, target_name))
                | Some(Binding::Fields(target_module, target_name)) => (target_module, target_name),
                _ => continue,
            };
            if resolved != (module, name.to_string()) {
                continue;
            }
            let declaration = match self.a.resolve(
                owner.module,
                &owner.trait_path,
                owner.absolute,
                true,
                0,
            ) {
                Some(Binding::Trait(index)) => index,
                _ => continue,
            };
            if self.a.traits[declaration].methods.contains_key(method) {
                found.push(declaration);
            }
        }
        if found.len() == 1 {
            found.pop()
        } else {
            None
        }
    }
    fn trait_target(&mut self, span: Span, decl: usize, method: &str, resolution: &str) {
        if self.state == 0 {
            self.call(span, None, "rust-cfg-unselected");
            return;
        }
        let file = self.function.file.clone();
        let (a, b) = self.a.bytes(&file, span);
        let mut r = self.a.range(&file, a, b);
        r["file"] = json!(file);
        let target = self.a.traits[decl].methods[method].clone();
        r["resolution"] = json!(resolution);
        r["target"] = json!({"file":target.file,"name":target.name,"line":target.line,"column":target.column});
        self.annotate_context(&mut r);
        self.a.calls.push(r);
    }
    fn impl_target(&mut self, span: Span, index: usize, resolution: &str) {
        let f = &self.a.functions[index];
        if self.state == 0 || f.state != 1 {
            self.call(span, None, "rust-cfg-unselected");
            return;
        }
        let file = self.function.file.clone();
        let (a, b) = self.a.bytes(&file, span);
        let mut r = self.a.range(&file, a, b);
        r["file"] = json!(file);
        let (line, column) = self.a.point(&f.file, f.start);
        r["resolution"] = json!(resolution);
        r["target"] = json!({"file":f.file,"name":f.name,"line":line,"column":column});
        self.annotate_context(&mut r);
        self.a.calls.push(r);
    }
    fn qualified_trait_call(&mut self, span: Span, path: &ExprPath) -> bool {
        let parts = path_parts(&path.path);
        if let Some(qself) = &path.qself {
            if qself.position != 1 || parts.len() != 2 {
                return false;
            }
            let method = parts[1].clone();
            let Some(decl) = self.resolve_trait(std::slice::from_ref(&parts[0]), false) else {
                return false;
            };
            if !self.a.traits[decl].methods.contains_key(&method) {
                return false;
            }
            let Type::Path(ty) = qself.ty.as_ref() else {
                return false;
            };
            if ty.qself.is_some() {
                return false;
            }
            let ty_parts = path_parts(&ty.path);
            let generic = ty_parts.len() == 1
                && self
                    .scopes
                    .iter()
                    .rev()
                    .any(|scope| scope.generic_bounds.contains_key(&ty_parts[0]));
            if generic {
                self.trait_target(span, decl, &method, "rust-trait-method-candidate");
                return true;
            }
            let Some((module, name)) =
                self.resolve_nominal(&ty_parts, ty.path.leading_colon.is_some())
            else {
                return false;
            };
            let mut functions = BTreeSet::new();
            for edge in &self.a.trait_impls {
                if edge.state == 1
                    && edge.trait_decl == decl
                    && edge.self_module == Some(module)
                    && edge.self_name.as_deref() == Some(name.as_str())
                    && edge.method == method
                {
                    functions.insert(edge.function);
                }
            }
            if functions.len() == 1 {
                let index = functions.pop_first().unwrap();
                self.impl_target(span, index, "rust-trait-impl");
                return true;
            }
            return false;
        }
        if parts.len() != 2 {
            return false;
        }
        let method = parts[1].clone();
        if let Some(decl) = self.resolve_trait(std::slice::from_ref(&parts[0]), false) {
            if self.a.traits[decl].methods.contains_key(&method) {
                self.trait_target(span, decl, &method, "rust-trait-method-candidate");
                return true;
            }
        }
        if let Some(decl) = self.bound_trait(&parts[0], &method) {
            self.trait_target(span, decl, &method, "rust-trait-method-candidate");
            return true;
        }
        false
    }
    fn method_call(&mut self, span: Span, call: &ExprMethodCall) {
        let method = call.method.to_string();
        if let Expr::Path(path) = call.receiver.as_ref() {
            if path.qself.is_none() && path.path.is_ident("self") {
                if let Some(index) = self
                    .function
                    .default_method
                    .as_ref()
                    .and_then(|method| method.trait_index)
                {
                    if self.a.traits[index].methods.contains_key(&method) {
                        self.trait_target(
                            span,
                            index,
                            &method,
                            "rust-trait-method-candidate",
                        );
                        return;
                    }
                }
            }
        }
        if let Some(hint) = self.receiver_hint(&call.receiver) {
            match hint {
                TypeHint::Generic(name) => {
                    if let Some(decl) = self.bound_trait(&name, &method) {
                        self.trait_target(span, decl, &method, "rust-trait-method-candidate");
                        return;
                    }
                }
                TypeHint::Dyn(parts, absolute) => {
                    if let Some(decl) = self.resolve_trait(&parts, absolute) {
                        if self.a.traits[decl].methods.contains_key(&method) {
                            self.trait_target(span, decl, &method, "rust-trait-method-candidate");
                            return;
                        }
                    }
                }
                TypeHint::Nominal(parts, absolute) => {
                    if let Some((module, name)) = self.resolve_nominal(&parts, absolute) {
                        if let Some(indices) = self
                            .a
                            .inherent_methods
                            .get(&(module, name.clone(), method.clone()))
                        {
                            if let Some(index) = unique_index(indices) {
                                self.impl_target(
                                    span,
                                    index,
                                    "rust-inherent-source-candidate",
                                );
                            } else {
                                self.call(span, None, "rust-trait-or-method-dispatch");
                            }
                            return;
                        }
                        if let Some(index) = self.unique_trait_impl(module, &name, &method) {
                            self.impl_target(span, index, "rust-trait-impl");
                            return;
                        }
                        if let Some(index) = self.inherited_trait_default(module, &name, &method) {
                            self.trait_target(
                                span,
                                index,
                                &method,
                                "rust-trait-method-candidate",
                            );
                            return;
                        }
                    }
                }
            }
        }
        self.call(span, None, "rust-trait-or-method-dispatch");
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
impl Scanner<'_> {
    fn register_block_macro(&mut self, stmt: &Stmt) -> bool {
        let Stmt::Item(Item::Macro(m)) = stmt else {
            return false;
        };
        if !m.mac.path.is_ident("macro_rules") {
            return false;
        }
        let krate = self.a.modules[self.function.module].krate;
        let state = self.a.attrs(&m.attrs, krate);
        if state < 0 {
            return true;
        }
        let Some(name_ident) = &m.ident else {
            return true;
        };
        let Ok(def) = syn::parse2::<ParsedMacroDef>(m.mac.tokens.clone()) else {
            return true;
        };
        let name = name_ident.to_string();
        let (line, column) = self.a.point(
            &self.function.file,
            self.a.bytes(&self.function.file, name_ident.span()).0,
        );
        let preserves = state == 1 && self.a.preserves_single_expr(&def.rules, krate);
        self.scopes
            .last_mut()
            .unwrap()
            .macros
            .entry(name.clone())
            .or_default()
            .push(MacroDef {
                name,
                file: self.function.file.clone(),
                line,
                column,
                module: self.function.module,
                krate,
                preserves,
                rules: def.rules,
            });
        true
    }
    fn block_macro(&self, name: &str, line: usize, column: usize) -> Option<MacroDef> {
        for scope in self.scopes.iter().rev() {
            if let Some(defs) = scope.macros.get(name) {
                if let Some(def) = defs
                    .iter()
                    .rev()
                    .find(|def| (def.line, def.column) < (line, column))
                {
                    return Some(def.clone());
                }
            }
        }
        None
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
            if self.register_block_macro(stmt) {
                continue;
            }
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
            let annotation = match &local.pat {
                Pat::Type(t) => Some(type_hint(&t.ty, &BTreeSet::new())),
                _ => None,
            };
            let hint = annotation.flatten().or_else(|| {
                local
                    .init
                    .as_ref()
                    .and_then(|init| type_hint_from_expr(&init.expr))
            });
            for name in names {
                let scope = self.scopes.last_mut().unwrap();
                scope.values.insert(name.clone());
                if let Some(hint) = &hint {
                    scope.local_types.insert(name, hint.clone());
                }
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
            let parent = self.callers.last().map(|c| c.qualname.clone()).unwrap_or_else(|| self.function.qualname.clone());
            let caller = self.caller_at(f.sig.span(), &f.sig.ident.to_string(), format!("{parent}::{}", f.sig.ident), "local-function");
            self.callers.push(caller);
            self.visit_block(&f.block);
            self.callers.pop();
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
            let parent = self.callers.last().map(|c| c.qualname.clone()).unwrap_or_else(|| self.function.qualname.clone());
            let caller = self.caller_at(item.sig.span(), &item.sig.ident.to_string(), format!("{parent}::{}", item.sig.ident), "method");
            self.callers.push(caller);
            self.visit_block(&item.block);
            self.callers.pop();
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
                let parent = self.callers.last().map(|c| c.qualname.clone()).unwrap_or_else(|| self.function.qualname.clone());
                let caller = self.caller_at(item.sig.span(), &item.sig.ident.to_string(), format!("{parent}::{}", item.sig.ident), "trait-default-method");
                self.callers.push(caller);
                self.visit_block(body);
                self.callers.pop();
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
        if path.map_or(false, |p| self.qualified_trait_call(call.span(), p)) {
            visit::visit_expr_call(self, call);
            return;
        }
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
    fn visit_expr_assign(&mut self, assign: &'ast ExprAssign) {
        if let Expr::Path(path) = assign.left.as_ref() {
            if path.qself.is_none() && path.path.segments.len() == 1 {
                let name = path.path.segments[0].ident.to_string();
                for scope in self.scopes.iter_mut().rev() {
                    if scope.local_types.remove(&name).is_some() {
                        break;
                    }
                }
            }
        }
        visit::visit_expr_assign(self, assign)
    }
    fn visit_expr_method_call(&mut self, call: &'ast ExprMethodCall) {
        self.method_call(call.span(), call);
        visit::visit_expr_method_call(self, call)
    }

    // Bind tuple-variant payloads so `match self { Some(inner) => ... }` can
    // resolve calls through the variant type. Only a `self` scrutinee carries
    // known type arguments today, so other match inputs stay unknown.
    fn visit_expr_match(&mut self, node: &'ast ExprMatch) {
        self.visit_expr(&node.expr);
        let scrutinee = self.receiver_hint(&node.expr);
        let args = match node.expr.as_ref() {
            Expr::Path(path) if path.path.is_ident("self") => {
                self.function.self_args.clone().unwrap_or_default()
            }
            _ => Vec::new(),
        };
        let Some(TypeHint::Nominal(parts, absolute)) = scrutinee else {
            for arm in &node.arms {
                self.visit_expr(&arm.body);
            }
            return;
        };
        for arm in &node.arms {
            let mut scope = Scope::default();
            if let Pat::TupleStruct(tuple) = &arm.pat {
                let Some(variant) =
                    tuple.path.segments.last().map(|s| s.ident.to_string())
                else {
                    self.scopes.push(scope);
                    self.visit_expr(&arm.body);
                    self.scopes.pop();
                    continue;
                };
                let name_guess = if tuple.path.segments.len() == 1 {
                    parts.last().cloned().unwrap_or_default()
                } else {
                    tuple.path.segments[tuple.path.segments.len() - 2]
                        .ident
                        .to_string()
                };
                let payload = self
                    .variant_owner(&tuple.path, &parts, absolute)
                    .and_then(|(module, name, _variant)| {
                        self.a
                            .enum_params
                            .get(&(module, name.clone()))
                            .zip(
                                self.a
                                    .variant_fields
                                    .get(&(module, name.clone(), variant.clone())),
                            )
                            .map(|(params, fields)| (params.clone(), fields.clone()))
                            .or_else(|| builtin_variant(&name, &variant))
                    })
                    .or_else(|| builtin_variant(&name_guess, &variant));
                if let Some((params, fields)) = payload {
                    for (pattern, hint) in tuple.elems.iter().zip(fields.iter()) {
                        let Some(hint) = substitute_hint(hint, &params, &args) else {
                            continue;
                        };
                        let mut names = Vec::new();
                        pattern_names(pattern, &mut names);
                        for name in names {
                            scope.values.insert(name.clone());
                            scope.local_types.insert(name, hint.clone());
                        }
                    }
                }
            }
            self.scopes.push(scope);
            if let Some((_, guard)) = &arm.guard {
                self.visit_expr(guard);
            }
            self.visit_expr(&arm.body);
            self.scopes.pop();
        }
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
        let krate = self.a.modules[self.function.module].krate;
        let name = m.path.segments.last().map(|s| s.ident.to_string()).unwrap_or_default();
        let (line, column) = self.a.point(&self.function.file, self.a.bytes(&self.function.file, m.path.segments[0].ident.span()).0);
        let shadowed = self.scopes.iter().any(|scope| scope.uses.contains_key(&name) || scope.uncertain_glob || !scope.globs.is_empty());
        let def = self.block_macro(&name, line, column).or_else(|| {
            self.a.preserving_macro(krate, self.function.module, line, m)
        });
        if self.state > 0 && !shadowed {
            if let Some(def) = def.filter(|def| def.preserves) {
                if let Ok(expr) = syn::parse2::<Expr>(m.tokens.clone()) {
                    self.macro_evidence.push(json!({
                        "name": def.name,
                        "definition": {"file": def.file, "line": def.line, "column": def.column},
                        "argumentUse": "once",
                        "expansion": "preserved",
                    }));
                    self.visit_expr(&expr);
                    self.macro_evidence.pop();
                    self.a.opaque.push(json!({
                        "file": self.function.file,
                        "line": self.a.point(&self.function.file, self.a.bytes(&self.function.file, m.span()).0).0,
                        "kind": "macro-argument-preserved",
                    }));
                    return;
                }
            }
        }
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
        nominal_parameters: BTreeMap::new(),
        fields: BTreeMap::new(),
        struct_params: BTreeMap::new(),
        struct_defaults: BTreeMap::new(),
        enum_params: BTreeMap::new(),
        variant_fields: BTreeMap::new(),
        inherent_pending: Vec::new(),
        inherent: BTreeMap::new(),
        inherent_methods: BTreeMap::new(),
        inherent_returns: BTreeMap::new(),
        wrap_pending: Vec::new(),
        wrap_targets: BTreeMap::new(),
        macro_defs: BTreeMap::new(),
        traits: Vec::new(),
        trait_pending: Vec::new(),
        trait_impls: Vec::new(),
        trait_impl_owners: Vec::new(),
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
                0,
                false,
            );
        } else {
            a.missing
                .push(json!({"crate":c.id,"file":c.root,"reason":"crate-root-unavailable"}));
        }
    }
    // Resolve owner identity after all module trees and local crate roots exist.
    for pending in a.inherent_pending.clone() {
        if let Some(Binding::Nominal(owner_module, owner_name))
        | Some(Binding::Fields(owner_module, owner_name)) =
            a.resolve(pending.module, &pending.owner, false, false, 0)
        {
            if let Some(returns) = pending.returns.clone() {
                a.inherent_returns
                    .entry((owner_module, owner_name.clone(), pending.name.clone()))
                    .or_default()
                    .push(returns);
            }
            if !pending.static_function {
                // Keep a method's receiver overload as a blocker for path calls,
                // while allowing direct method-call resolution by receiver.
                a.inherent
                    .entry((owner_module.clone(), owner_name.clone(), pending.name.clone()))
                    .or_default()
                    .push(None);
                a.inherent_methods
                    .entry((owner_module, owner_name, pending.name))
                    .or_default()
                    .push(Some(pending.index));
                continue;
            }
            let index = if let Some(parameters) = a
                .nominal_parameters
                .get(&(owner_module, owner_name.clone()))
            {
                // A generic/receiver/otherwise unsupported sibling remains a
                // blocker, rather than disappearing from the overload inventory.
                (pending.static_function && pending.parameters == *parameters)
                    .then_some(pending.index)
            } else if pending.parameters == Parameters::None && pending.static_function {
                Some(pending.index)
            } else {
                continue;
            };
            a.inherent
                .entry((owner_module, owner_name, pending.name))
                .or_default()
                .push(index);
        }
    }
    for pending in a.wrap_pending.clone() {
        let Some((path, absolute)) = &pending.self_path else {
            continue;
        };
        let target = match a.resolve(pending.module, &pending.trait_path, pending.absolute, false, 0)
        {
            Some(Binding::Trait(decl)) => {
                let trait_decl = &a.traits[decl];
                if !trait_decl.methods.contains_key(&pending.method) {
                    continue;
                }
                let declared = trait_decl
                    .returns
                    .get(&pending.method)
                    .and_then(|hint| substitute_hint(hint, &trait_decl.generics, &pending.args));
                if pending.method == "deref" {
                    pending.associated.clone().or(declared)
                } else {
                    declared
                }
            }
            _ => match a.std_accessor_name(pending.module, &pending.trait_path) {
                Some(name) if name == "Deref" => pending.associated.clone(),
                Some(_) => pending.args.first().cloned(),
                None => None,
            },
        };
        let Some(target) = target else {
            continue;
        };
        if let Some(Binding::Nominal(owner_module, owner_name))
        | Some(Binding::Fields(owner_module, owner_name)) =
            a.resolve(pending.module, path, *absolute, false, 0)
        {
            a.wrap_targets
                .entry((owner_module, owner_name, pending.method))
                .or_default()
                .push(target);
        }
    }
    // Resolve trait declarations and impl edges after all module trees exist.
    for pending in a.trait_pending.clone() {
        let trait_decl = match a.resolve(
            pending.module,
            &pending.trait_path,
            pending.absolute,
            false,
            0,
        ) {
            Some(Binding::Trait(index)) => index,
            _ => continue,
        };
        let (self_module, self_name) = match &pending.self_path {
            Some((self_path, self_absolute)) => {
                match a.resolve(pending.module, self_path, *self_absolute, false, 0) {
                    Some(Binding::Nominal(module, name))
                    | Some(Binding::Fields(module, name)) => (Some(module), Some(name)),
                    _ => (None, None),
                }
            }
            None => (None, None),
        };
        if !a.traits[trait_decl].methods.contains_key(&pending.method) {
            continue;
        }
        a.trait_impls.push(TraitImpl {
            trait_decl,
            self_module,
            self_name,
            self_type: pending.self_type,
            method: pending.method,
            function: pending.function,
            state: pending.state,
        });
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
                        Some(Binding::Module(i))
                        | Some(Binding::Nominal(i, _))
                        | Some(Binding::Fields(i, _)) => {
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
        let mut scope = f.signature.clone();
        scope.values.extend(f.params.clone());
        scope.types.extend(f.generics.clone());
        if let Some(hint) = &f.self_type {
            scope.local_types.insert("self".into(), hint.clone());
        }
        let body = f.body.clone();
        let state = f.state;
        let kind = if f.default_method.is_some() {
            "trait-default-method"
        } else if f.macro_expanded {
            "macro-generated-method"
        } else if f.self_type.is_some() {
            "method"
        } else {
            "function"
        };
        let (line, column) = a.point(&f.file, f.start);
        let caller = Caller { file: f.file.clone(), name: f.name.clone(), qualname: f.qualname.clone(), kind, line, column };
        let mut scanner = Scanner {
            a: &mut a,
            function: f,
            callers: vec![caller],
            scopes: vec![scope],
            state,
            macro_evidence: Vec::new(),
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
    let traits: Vec<_> = a
        .traits
        .iter()
        .map(|decl| {
            json!({
                "declaration": {"file":decl.file,"name":decl.name,"qualname":decl.qualname,"line":decl.line,"column":decl.column},
                "methods": decl.methods.values().map(|m| json!({"file":m.file,"name":m.name,"qualname":m.qualname,"line":m.line,"column":m.column})).collect::<Vec<_>>()
            })
        })
        .collect();
    let trait_implementations: Vec<_> = a
        .trait_impls
        .iter()
        .map(|edge| {
            let f = &a.functions[edge.function];
            let range = a.range(&f.file, f.start, f.end);
            let decl = &a.traits[edge.trait_decl];
            let method = &decl.methods[&edge.method];
            json!({
                "trait": {"file":decl.file,"name":decl.name,"qualname":decl.qualname,"line":decl.line,"column":decl.column},
                "traitMethod": {"file":method.file,"name":method.name,"qualname":method.qualname,"line":method.line,"column":method.column},
                "implementation": {"file":f.file,"name":f.name,"qualname":f.qualname,"line":range["line"],"column":range["column"]},
                "selfType": edge.self_type
            })
        })
        .collect();
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
            let outcome = |call: &Value| {
                (
                    call.get("resolution").cloned(),
                    call.get("target").cloned(),
                    call.get("reason").cloned(),
                )
            };
            let first_outcome = outcome(&first);
            if v.iter().any(|call| outcome(call) != first_outcome) {
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
    println!("{}",serde_json::to_string(&json!({"selected":a.selected,"functions":functions,"calls":calls,"imports":a.imports,"modules":modules,"traits":traits,"traitImplementations":trait_implementations,"parse_errors":a.parse_errors,"excludedRegions":a.excluded_regions,"opaqueMacros":a.opaque,"missingModules":a.missing})).unwrap());
}
