package com.aurora.xr;

import android.content.Context;
import java.io.*;
import java.util.*;
import java.util.zip.*;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;

public final class AuroraRuntime {
    private static volatile boolean active=false;
    private static Process node,model,embedder;
    private static boolean dynamicBackends=false;
    private static final String VERSION="standalone-092-route";
    public static synchronized void start(Context context) {
        if(active)return;active=true;
        final Context app=context.getApplicationContext();
        new Thread(()->{
            try {
                File root=new File(app.getFilesDir(),VERSION),data=new File(app.getFilesDir(),"aurora-data");data.mkdirs();
                File saved=new File(app.getExternalFilesDir(null),"UnrealGame/AuroraXR/AuroraXR/Saved");saved.mkdirs();
                File marker=new File(root,"ready");
                if(!marker.exists()){
                    root.mkdirs();
                    try(ZipInputStream zip=new ZipInputStream(app.getAssets().open("aurora-runtime.zip"))){
                        ZipEntry e;byte[] buffer=new byte[131072];String allowed=root.getCanonicalPath()+File.separator;
                        while((e=zip.getNextEntry())!=null){File file=new File(root,e.getName());
                            if(!file.getCanonicalPath().startsWith(allowed))throw new IOException("Invalid runtime path");
                            if(e.isDirectory()){file.mkdirs();continue;}file.getParentFile().mkdirs();
                            try(FileOutputStream out=new FileOutputStream(file)){int n;while((n=zip.read(buffer))>0)out.write(buffer,0,n);}
                        }
                    }
                    marker.createNewFile();
                }
                String nativeDir=app.getApplicationInfo().nativeLibraryDir;
                String key=UUID.randomUUID().toString()+UUID.randomUUID().toString();
                JSONObject engine=new JSONObject(new String(Files.readAllBytes(new File(root,"harness/engine-config.json").toPath()),StandardCharsets.UTF_8));
                dynamicBackends=engine.optBoolean("dynamicBackends",false);
                if(!"original-harness".equals(engine.getString("contextProfile")))throw new IOException("Unexpected Harness context profile");
                File modelRoot="external".equals(engine.getString("modelStorage"))?new File(app.getExternalFilesDir(null),"models"):root;
                String[] modelArgs=serverArgs(nativeDir,verifiedWeights(modelRoot,engine),18080,key,engine.getJSONArray("args"));
                JSONObject embedding=engine.optJSONObject("embedding");
                String[] embedArgs=embedding==null?null:serverArgs(nativeDir,verifiedWeights(modelRoot,embedding),embedding.getInt("port"),key,embedding.getJSONArray("args"));
                // The headset client asks for the embedded Harness only when the paired PC does not
                // answer (flag file in Saved); otherwise its ~3 GB stay free for the MR experience.
                File wanted=new File(saved,"aurora-runtime-wanted");
                for(int failures=0;active&&failures<3;){
                    if(!wanted.exists()){Thread.sleep(2000);continue;}
                    model=launch(modelArgs,root,data,saved,key,"model.log");
                    if(embedArgs!=null)embedder=launch(embedArgs,root,data,saved,key,"embedding.log");
                    node=launch(new String[]{nativeDir+"/libaurora_node.so",new File(root,"harness/quest-main.mjs").getPath()},root,data,saved,key,"harness.log");
                    while(active&&wanted.exists()&&node.isAlive()&&model.isAlive()&&(embedder==null||embedder.isAlive()))Thread.sleep(2000);
                    final boolean crashed=active&&wanted.exists();
                    stopChildren();
                    if(crashed){failures++;Thread.sleep(3000);}
                }
            }catch(Exception e){android.util.Log.e("AuroraRuntime","Standalone startup failed",e);stopChildren();}
        },"AuroraHarnessRuntime").start();
    }
    // Separately provisioned weights are checked before loading; a missing or corrupt
    // file stops startup instead of silently substituting another model. The full
    // hash is recomputed only when the file's size or modification time changes.
    private static File verifiedWeights(File modelRoot,JSONObject spec)throws Exception{
        File weights=new File(modelRoot,spec.getString("modelFile"));
        if(!weights.getCanonicalPath().startsWith(modelRoot.getCanonicalPath()+File.separator))throw new IOException("Invalid model path");
        if(!weights.isFile()||weights.length()!=spec.getLong("modelBytes"))throw new IOException("Original model is missing or incomplete: "+weights.getPath());
        if(!spec.has("modelSha256"))return weights;
        String expected=spec.getString("modelSha256"),stamp=expected+" "+weights.length()+" "+weights.lastModified();
        File cache=new File(modelRoot,weights.getName()+".verified");
        if(cache.isFile()&&stamp.equals(new String(Files.readAllBytes(cache.toPath()),StandardCharsets.UTF_8)))return weights;
        MessageDigest digest=MessageDigest.getInstance("SHA-256");byte[] block=new byte[1048576];
        try(InputStream in=new FileInputStream(weights)){int n;while((n=in.read(block))!=-1)digest.update(block,0,n);}
        StringBuilder hash=new StringBuilder();for(byte value:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",value&255));
        if(!hash.toString().equals(expected))throw new IOException("Model checksum mismatch: "+weights.getName());
        Files.write(cache.toPath(),stamp.getBytes(StandardCharsets.UTF_8));
        return weights;
    }
    private static String[] serverArgs(String nativeDir,File weights,int port,String key,JSONArray tuning)throws JSONException{
        ArrayList<String> args=new ArrayList<>(Arrays.asList(nativeDir+"/libaurora_llama.so","-m",weights.getPath(),"--host","127.0.0.1","--port",String.valueOf(port),"--api-key",key));
        for(int i=0;i<tuning.length();i++)args.add(tuning.getString(i));
        return args.toArray(new String[0]);
    }
    private static Process launch(String[] args,File root,File data,File saved,String key,String log)throws IOException{
        ProcessBuilder builder=new ProcessBuilder(args);builder.directory(new File(root,"harness"));
        Map<String,String> env=builder.environment();
        env.put("LD_LIBRARY_PATH",new File(root,"lib").getPath());
        if(dynamicBackends)env.put("GGML_BACKEND_PATH",new File(root,"lib/libggml-cpu.so").getPath());else env.remove("GGML_BACKEND_PATH");
        env.put("HOME",data.getPath());env.put("TMPDIR",data.getPath());env.put("AURORA_DATA",data.getPath());env.put("AURORA_SAVED",saved.getPath());env.put("LOCAL_API_KEY",key);
        env.put("TZ",TimeZone.getDefault().getID());
        return builder.redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.appendTo(new File(data,log))).start();
    }
    private static synchronized void stopChildren(){if(node!=null)node.destroy();if(model!=null)model.destroy();if(embedder!=null)embedder.destroy();}
    public static synchronized void stop(){active=false;stopChildren();}
}
