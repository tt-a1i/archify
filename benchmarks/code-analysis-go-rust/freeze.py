import subprocess,json,hashlib,pathlib,argparse
args=argparse.ArgumentParser(description='Recreate the source-only manifest from four local upstream clones.')
args.add_argument('--samples-root',type=pathlib.Path,required=True)
args.add_argument('--out',type=pathlib.Path,required=True)
args=args.parse_args()
root=args.samples_root
def git(p,*args):return subprocess.check_output(['git','-C',str(root/p),*args])
def source(p,ref,file):return git(p,'show',f'{ref}:{file}')
def evidence(p,ref,file,needle):
 b=source(p,ref,file); lines=b.decode().splitlines(); hits=[i+1 for i,l in enumerate(lines) if needle in l]
 if not hits: return {'file':file,'sha256':hashlib.sha256(b).hexdigest(),'needle':needle,'lines':[],'absence':'Not present in this fixed version; do not score as an omitted call.'}
 return {'file':file,'sha256':hashlib.sha256(b).hexdigest(),'needle':needle,'lines':hits,'source_context':[{'line':n,'text':'\n'.join(lines[max(0,n-4):n+3])} for n in hits]}
projects=[
 ('cobra','go','41fd44e1df83ad6acd8e14b304d5f2a2ae1d62f5','e392f3204db0445f1f4ad47448b04d8c8ad04c2a','design',[
 ('definition','doc/man_docs.go','func GenMan('),('call','doc/man_examples_test.go','doc.GenMan(cmd, header, out)'),('import','doc/man_examples_test.go','"github.com/spf13/cobra/doc"'),('caller','doc/man_examples_test.go','func ExampleGenMan()'),('direct internal caller','doc/man_docs.go','return GenMan(cmd, &headerCopy, f)'),('unknown interface dispatch','doc/man_docs.go','w.Write(md2man.Render(b))')]),
 ('chi','go','v5.1.0','v5.2.1','reserved-review',[
 ('definition','context.go','func RouteContext('),('call','middleware/strip.go','chi.RouteContext(r.Context())'),('import','middleware/strip.go','"github.com/go-chi/chi/v5"'),('alias import','_examples/versions/main.go','v1 "github.com/go-chi/chi/v5/_examples/versions/presenter/v1"'),('alias call','_examples/versions/main.go','v1.NewArticleResponse(article)'),('alias definition','_examples/versions/presenter/v1/article.go','func NewArticleResponse('),('unknown interface dispatch','middleware/strip.go','next.ServeHTTP(w, r)')]),
 ('regex','rust','1.7.0','1.11.1','design',[
 ('changed definition','regex-syntax/src/unicode.rs','pub fn is_word_character('),('explicit module call','regex-syntax/src/lib.rs','unicode::is_word_character(c)'),('workspace call','src/lib.rs','regex_syntax::escape(pattern)'),('workspace definition','regex-syntax/src/lib.rs','pub fn escape(')]),
 ('serde-json','rust','v1.0.100','v1.0.139','reserved-review',[
 ('changed definition','src/lexical/algorithm.rs','fn fast_path<'),('wildcard import','src/lexical/parse.rs','use super::algorithm::*;'),('call','src/lexical/parse.rs','fast_path(mantissa, mant_exp)'),('caller','src/lexical/parse.rs','pub fn parse_concise_float<'),('feature gate','src/lib.rs','#[cfg(feature = "float_roundtrip")]'),('unknown trait method','src/lexical/algorithm.rs','F::exponent_limit()')])]
out={'schema':1,'freeze_stage':'before any analyzer run or implementation','candidate_parent':'93378351dc97768fd7e0882a50f32ecc7a34e2a6','projects':[]}
for p,lang,base,head,role,items in projects:
 b=git(p,'rev-parse',base+'^{}').decode().strip();h=git(p,'rev-parse',head+'^{}').decode().strip()
 rec={'project':p,'language':lang,'repository':git(p,'remote','get-url','origin').decode().strip(),'base':b,'head':h,'role':role,'expected_evidence':{}}
 for side,ref in [('base',b),('head',h)]:
  rec['expected_evidence'][side]=[{'kind':kind,**evidence(p,ref,f,n)} for kind,f,n in items]
 rec['metadata']={f:source(p,h,f).decode() for f in (['go.mod'] if lang=='go' else ['Cargo.toml'])}
 out['projects'].append(rec)
# Head-only Rust use and alias sites belong to the newer regex-automata workspace layout.
r=out['projects'][2];r['head_supplement']=[{'kind':k,**evidence('regex',r['head'],f,n)} for k,f,n in [
 ('use alias','regex-automata/src/dfa/special.rs','use crate::util::wire::write_state_id as write;'),('alias direct call','regex-automata/src/dfa/special.rs','write::<E>(self.max,'),('alias target','regex-automata/src/util/wire.rs','fn write_state_id<'),('plain use','regex-automata/src/util/look.rs','use regex_syntax::try_is_word_character;'),('plain use call','regex-automata/src/util/look.rs','Some(Ok(ch)) => try_is_word_character(ch)'),('target','regex-syntax/src/lib.rs','pub fn try_is_word_character('),('macro unknown','regex-automata/src/dfa/special.rs','assert_eq!(')]]
p=args.out;p.write_text(json.dumps(out,indent=2)+'\n');print(hashlib.sha256(p.read_bytes()).hexdigest())
