// Check source syntax without printing any matched credential value.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),findings=[];
const sensitive=/^(?:password|passwd|passphrase|serviceAccountPassword|accountPassword|clientSecret|apiSecret|refreshToken|accessToken)$/i;
const authCalls=new Set(['authenticate','reauthenticateCurrentUser','changeCurrentPassword','signInWithPassword']);
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory()){walk(f);continue;}if(!/\.[cm]?[jt]sx?$/.test(f))continue;
 const text=fs.readFileSync(f,'utf8'),sf=ts.createSourceFile(f,text,ts.ScriptTarget.Latest,true,/\.tsx$/.test(f)?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const nonempty=n=>n&&(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))&&n.text.length>0;
 function report(n,kind){findings.push({file:path.relative(root,f),line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,kind});}
 function visit(n){
  if((ts.isPropertyAssignment(n)||ts.isVariableDeclaration(n))&&n.name&&sensitive.test(n.name.getText(sf).replace(/^['"]|['"]$/g,''))&&nonempty(n.initializer))report(n,'embedded_credential');
  if(ts.isCallExpression(n)){
   const name=ts.isPropertyAccessExpression(n.expression)?n.expression.name.text:ts.isIdentifier(n.expression)?n.expression.text:'';
   const args = name === 'authenticate' ? [n.arguments[1]] : name === 'signInWithPassword' ? [] : [...n.arguments];
   if(authCalls.has(name)&&args.some(nonempty))report(n,'literal_authentication_argument');
  }
  ts.forEachChild(n,visit);
 }visit(sf);
}}
walk(path.join(root,'src'));walk(path.join(root,'tests'));
assert.deepEqual(findings,[],JSON.stringify(findings));
console.log('PASS: no nonempty credential literals or literal authentication arguments in source and test fixtures');
