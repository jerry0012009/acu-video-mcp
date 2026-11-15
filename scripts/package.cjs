const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),https=require('node:https');
const {execFileSync}=require('node:child_process');
const platform=process.platform,arch=process.arch,version='0.1.0',nodeVersion='24.22.3';
const pins={
 'linux-x64':'061ec3e3062115705b56b51fa9cc330ab50d34b6969387d4e4b1a50c6809acc2',
 'darwin-x64':'977614af0504c81045e7fd85596dbca0e5f951b96681516dadafedcca8c447f7',
 'darwin-arm64':'ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd',
 'win32-x64':'e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f'};
async function main(){
 const key=platform+'-'+arch;if(!pins[key])throw Error('unsupported platform '+key);
 const stage=path.resolve('dist/stage');fs.mkdirSync(stage,{recursive:true});
 const osName=platform==='win32'?'win':platform,ext=platform==='win32'?'zip':'tar.gz';
 const archive=path.resolve('dist/node.'+ext),url=`https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-${osName}-${arch}.${ext}`;
 if(!fs.existsSync(archive))await new Promise((resolve,reject)=>{https.get(url,r=>{if(r.statusCode!==200)return reject(Error('Node download '+r.statusCode));const f=fs.createWriteStream(archive);r.pipe(f);f.on('finish',()=>f.close(resolve));r.on('error',reject)}).on('error',reject)});
 if(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')!==pins[key])throw Error('Node SHA256 mismatch');
 if(platform==='win32')execFileSync('powershell',['-NoProfile','-Command',`Expand-Archive -LiteralPath '${archive}' -DestinationPath '${stage}/node-dist' -Force`]);
 else execFileSync('tar',['-xzf',archive,'-C',stage]);
 const nodeDir=platform==='win32'?path.join(stage,'node-dist',`node-v${nodeVersion}-win-${arch}`):path.join(stage,`node-v${nodeVersion}-${platform}-${arch}`);
 const node=path.join(nodeDir,platform==='win32'?'node.exe':'bin/node'),npm=path.join(nodeDir,platform==='win32'?'node_modules/npm/bin/npm-cli.js':'lib/node_modules/npm/bin/npm-cli.js');
 for(const name of ['package.json','package-lock.json','launch.cjs'])fs.copyFileSync(path.join('bundle',name),path.join(stage,name));
 const pkg=JSON.parse(fs.readFileSync(path.join(stage,'package.json'))),lock=JSON.parse(fs.readFileSync(path.join(stage,'package-lock.json')));
 for(const p of ['ffmpeg','ffprobe']){const name=`@${p}-installer/${platform}-${arch}`,entry=lock.packages['node_modules/'+name];if(!entry)throw Error('binary not locked');pkg.dependencies[name]=entry.version;delete entry.optional;}
 lock.packages[''].dependencies=pkg.dependencies;
 fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify(pkg));fs.writeFileSync(path.join(stage,'package-lock.json'),JSON.stringify(lock));
 execFileSync(node,[npm,'ci','--ignore-scripts','--include=optional','--no-audit','--no-fund'],{cwd:stage,stdio:'inherit'});
 fs.mkdirSync(path.join(stage,'bin'),{recursive:true});
 for(const p of ['ffmpeg','ffprobe']){const file=p+(platform==='win32'?'.exe':'');fs.copyFileSync(path.join(stage,'node_modules',`@${p}-installer`,`${platform}-${arch}`,file),path.join(stage,'bin',file));fs.chmodSync(path.join(stage,'bin',file),0o755);execFileSync(path.join(stage,'bin',file),['-version']);}
 fs.copyFileSync(node,path.join(stage,platform==='win32'?'node.exe':'node'));fs.copyFileSync(path.join(nodeDir,'LICENSE'),path.join(stage,'NODE-LICENSE'));fs.rmSync(nodeDir,{recursive:true,force:true});fs.rmSync(path.join(stage,'node-dist'),{recursive:true,force:true});
 if(platform==='darwin')for(const file of ['node','bin/ffmpeg','bin/ffprobe'])execFileSync('codesign',['--force','--sign','-',path.join(stage,file)]);
 fs.mkdirSync(path.join(stage,'home','.claude-video-vision'),{recursive:true});fs.writeFileSync(path.join(stage,'home','.claude-video-vision','config.json'),JSON.stringify({frame_resolution:768,max_frames:24,enable_index:false}));
 fs.copyFileSync('LICENSE',path.join(stage,'ACU-LICENSE'));fs.copyFileSync('NOTICE.md',path.join(stage,'NOTICE.md'));
 const zipper=String.raw`import pathlib,zipfile,sys
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted(root.rglob('*')):
  if p.is_file(): z.write(p,p.relative_to(root))
`;
 execFileSync(platform==='win32'?'python':'python3',['-c',zipper,stage,path.resolve('bundle/payload.zip')]);
 const osGo=platform==='win32'?'windows':platform,goArch=arch==='x64'?'amd64':arch,name=`acu-video-mcp-${osGo}-${goArch}`+(platform==='win32'?'.exe':'');fs.mkdirSync('dist/release',{recursive:true});
 execFileSync('go',['build','-trimpath','-o',path.join('dist/release',name),'.'],{stdio:'inherit'});
 if(platform==='darwin'){execFileSync('codesign',['--force','--sign','-',path.join('dist/release',name)]);}
 execFileSync(path.resolve('dist/release',name),['--self-test'],{stdio:'inherit'});
 console.log('Packaged '+name+' '+version);
}
main().catch(e=>{console.error(e);process.exitCode=1});
