<?php
declare(strict_types=1);
namespace GECC;
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require __DIR__.'/bootstrap.php';
try {
    $path=$argv[1]??'';if(!is_file($path))fail(400,'Usage: php roster.php roster.json [--apply REVISION]');
    $input=decode(file_get_contents($path));
    if(!is_array($input->units??null)||count($input->units)!==32)fail(400,'ต้องมีรายชื่อจริงครบ 32 หน่วยงาน');
    $apply=($argv[2]??'')==='--apply';$lock=query("SELECT GET_LOCK('gecc_roster',30)")->fetchColumn();if((int)$lock!==1)fail(409,'มีการปรับรายชื่ออื่นอยู่');
    try {
        $report=tx(function()use($input,$apply,$argv){
            [$s,$revision]=state(true);$known=[];foreach($s->units as $u)$known[$u->code]=$u;
            $seen=[];$names=[];$units=[];$changes=[];$seq=$s->nextUnitCode??(count($s->units)+1);
            foreach($input->units as $row){
                if(!is_string($row->name??null)||!trim($row->name)||in_array(trim($row->name),$names,true)||!is_int($row->team??null)||!find($s->teams,fn($t)=>$t->id===$row->team))fail(400,'ชื่อหรือกลุ่มไม่ถูกต้อง/ซ้ำ');
                $names[]=trim($row->name);$code=$row->code??'';
                if($code!==''){
                    if(!is_string($code)||!isset($known[$code])||isset($seen[$code]))fail(400,'รหัสเดิมไม่ถูกต้องหรือซ้ำ');
                    $u=copy_value($known[$code]);$seen[$code]=true;$changes[]=['code'=>$code,'before'=>$u->name,'after'=>trim($row->name),'team'=>$row->team];
                }else{
                    do{$code=str_pad((string)$seq++,6,'0',STR_PAD_LEFT);}while(isset($known[$code]));
                    $u=(object)['id'=>'u'.uid(),'code'=>$code,'kind'=>'new','prev'=>''];$changes[]=['code'=>$code,'before'=>null,'after'=>trim($row->name),'team'=>$row->team];
                }
                $u->name=trim($row->name);$u->team=$row->team;$u->district=is_string($row->district??null)?$row->district:($u->district??'');$units[]=$u;
            }
            if(count($seen)!==count($known))fail(400,'รายชื่อใหม่ต้องคงรหัสหน่วยงานเดิมทั้งหมด ห้ามลบข้อมูลเดิม');
            if(!$apply)return ['applied'=>false,'revision'=>$revision,'changes'=>$changes,'accounts'=>'สร้างบัญชีสำหรับหน่วยงานใหม่ผ่านหลังบ้านหลังตรวจรับ'];
            if(!isset($argv[3])||!ctype_digit($argv[3])||(int)$argv[3]!==$revision)fail(409,'ต้องใช้ revision จาก preview ล่าสุด');
            $dir=__DIR__.'/backups';if(!is_dir($dir)&&!mkdir($dir,0700,true))throw new \RuntimeException();
            $file=$dir.'/roster-'.uid().'.json';if(file_put_contents($file,encode($s),LOCK_EX)===false)throw new \RuntimeException();chmod($file,0600);
            $s->units=$units;$s->nextUnitCode=$seq;query('UPDATE gecc_app_state SET document=?,revision=? WHERE id=1',[encode($s),$revision+1]);audit(null,'roster-migrate','units',$revision+1);
            return ['applied'=>true,'revision'=>$revision+1,'changes'=>$changes];
        });echo encode($report)."\n";
    }finally{query("SELECT RELEASE_LOCK('gecc_roster')");}
}catch(\Throwable $e){fwrite(STDERR,($e instanceof HttpError?$e->getMessage():'Roster update failed; inspect private logs.')."\n");exit(1);}
