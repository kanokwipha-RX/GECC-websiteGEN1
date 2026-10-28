<?php
declare(strict_types=1);
namespace GECC;

// Inverse of UTF-8 bytes mistakenly decoded as Windows-874. Never guess lost bytes.
function repair_thai_text(string $text): string {
    static $reverse;
    if ($reverse===null) {
        $reverse=[];
        $special=[0x80=>0x20ac,0x85=>0x2026,0x91=>0x2018,0x92=>0x2019,0x93=>0x201c,
            0x94=>0x201d,0x95=>0x2022,0x96=>0x2013,0x97=>0x2014];
        for ($i=0;$i<=0xfb;$i++) {
            if ($i>=0xdb && $i<=0xde) continue;
            $point=$special[$i]??($i>=0xa1 ? 0x0e01+$i-0xa1 : $i);
            $reverse[mb_chr($point,'UTF-8')]=chr($i);
        }
    }
    for ($pass=0;$pass<3;$pass++) {
        $markers=preg_match_all('/(?:เธ|เน)/u',$text);
        if ($markers<2 || str_contains($text,"\u{FFFD}")) break;
        $bytes='';
        foreach (mb_str_split($text,1,'UTF-8') as $char) {
            if (!isset($reverse[$char])) return $text;
            $bytes.=$reverse[$char];
        }
        if (!mb_check_encoding($bytes,'UTF-8') || str_contains($bytes,"\u{FFFD}")
            || !preg_match('/[ก-๛]/u',$bytes) || preg_match_all('/(?:เธ|เน)/u',$bytes)>=$markers) break;
        $text=$bytes;
    }
    return $text;
}
function repair_thai_value(mixed $value, array &$changes, string $path='state'): mixed {
    if (is_string($value)) {
        $fixed=repair_thai_text($value);
        if ($fixed!==$value) $changes[]=['path'=>$path,'before'=>$value,'after'=>$fixed];
        return $fixed;
    }
    if (is_array($value) || is_object($value)) {
        $next=is_array($value)?[]:new \stdClass();
        foreach ($value as $key=>$child) {
            $fixed=repair_thai_value($child,$changes,$path.'.'.$key);
            if (is_array($next)) $next[$key]=$fixed; else $next->$key=$fixed;
        }
        return $next;
    }
    return $value;
}
function repair_encoding(?int $revision, array $actor): array {
    return tx(function()use($revision,$actor){
        [$state,$r]=state(true);
        if ($revision!==null && $revision!==$r) fail(409,'ข้อมูลเปลี่ยนแปลง กรุณาตรวจภาษาไทยใหม่');
        $changes=[];$next=repair_thai_value($state,$changes);
        $accounts=query('SELECT id,name FROM gecc_accounts ORDER BY id FOR UPDATE')->fetchAll();
        $fixedAccounts=repair_thai_value($accounts,$changes,'accounts');
        $preview=['revision'=>$r,'count'=>count($changes),'examples'=>array_slice($changes,0,20)];
        if ($revision===null || !$changes) return $preview+['applied'=>false];
        // Keep an exclusive private snapshot before the atomic database update.
        $dir=__DIR__.'/backups';
        if (!is_dir($dir) && !mkdir($dir,0700,true)) fail(503,'สร้างพื้นที่สำรองข้อมูลไม่ได้');
        $name='encoding-'.$r.'-'.bin2hex(random_bytes(8)).'.json';
        $fp=@fopen($dir.'/'.$name,'x+b');
        if (!$fp) fail(503,'สร้างไฟล์สำรองไม่ได้ จึงยังไม่แก้ข้อมูล');
        try {
            if (!chmod($dir.'/'.$name,0600)) fail(503,'กำหนดสิทธิ์ไฟล์สำรองไม่ได้');
            $backup=encode(['revision'=>$r,'createdAt'=>now(),'state'=>$state,'accounts'=>$accounts]);
            if (fwrite($fp,$backup)!==strlen($backup) || !fflush($fp)) fail(503,'บันทึกข้อมูลสำรองไม่สำเร็จ');
        } finally {fclose($fp);}
        foreach ($fixedAccounts as $i=>$account) if ($account['name']!==$accounts[$i]['name'])
            query('UPDATE gecc_accounts SET name=? WHERE id=?',[$account['name'],$account['id']]);
        save_state($next,$r,$actor['id'],'repair-encoding');
        return $preview+['applied'=>true,'backup'=>$name];
    });
}
