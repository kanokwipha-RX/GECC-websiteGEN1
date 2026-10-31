<?php
declare(strict_types=1);
require __DIR__.'/../php/bootstrap.php';
require __DIR__.'/../php/refresh-plan.php';
use function GECC\{decode,copy_value,same,content_refresh_plan,find};
function check(bool $condition,string $message):void {if(!$condition)throw new RuntimeException($message);}
$base=decode(file_get_contents(__DIR__.'/../php/data/content-refresh-baseline.json'));
$wanted=decode(file_get_contents(__DIR__.'/../shared/roster-2570.json'));
$live=copy_value($base);
$live->assess=(object)['u01'=>(object)['evidence'=>'preserve uploaded evidence reference','score'=>241]];
$live->defects=[(object)['id'=>'d-existing','unitId'=>'u01','detail'=>'keep reviewer text']];
$live->nextUnitCode=29;$live->retiredUnitIds=[];
$live->units[0]->customNote='keep organization note';
$live->publicContent->library=[(object)['name'=>'Private configured Library','url'=>'https://drive.google.com/drive/folders/existing']];
$live->publicContent->videos=[(object)['title'=>'Keep current video','category'=>'activity','url'=>'','status'=>'draft']];
$live->publicContent->albums=[(object)['title'=>'Existing custom album','date'=>'2026-10-01','status'=>'published','images'=>[]]];
$wanted->publicContent->albums=[(object)['id'=>'gecc-2026-10-29','title'=>'29 ตุลาคม 2569','date'=>'2026-10-29','status'=>'published','images'=>[]]];
$account=['username'=>'mentor-01-01','name'=>'นางสาวชลธิชา พูลทวี','role'=>'mentor','team'=>1];
$plan=content_refresh_plan($live,$wanted,$base,[$account]);$next=$plan['next'];
check($plan['canApply'],'Unmodified official roster should migrate without conflicts');
check(count($next->units)===32,'Expected 32 units');
check(same($next->assess,$live->assess)&&same($next->defects,$live->defects),'Assessments and findings must be preserved');
foreach($live->units as $old){$new=find($next->units,fn($u)=>$u->id===$old->id);check($new&&$new->code===$old->code,'Existing organization code/id changed');}
check($next->units[0]->customNote==='keep organization note','Custom organization fields must be preserved');
check(same($next->publicContent->library,$live->publicContent->library),'Live Library links must not be replaced');
check(same($next->publicContent->videos,$live->publicContent->videos),'Live videos must not be replaced');
check(count($next->publicContent->albums)===2,'New album must append to existing custom albums');
check($plan['accountsChanged']===false&&$plan['accountReview'][0]['username']==='mentor-01-01'&&$plan['accountReview'][0]['status']==='matched','Reordered cards must not reassign accounts');
$again=content_refresh_plan($next,$wanted,$base,[$account]);
check($again['canApply']&&same($again['next'],$next),'Refresh must be idempotent');
$custom=copy_value($live);$custom->publicContent->committee[0]->photo='assets/images/custom-committee.jpg';
$blocked=content_refresh_plan($custom,$wanted,$base);
check(!$blocked['canApply']&&str_contains(implode(',',$blocked['conflicts']),'committee'),'Custom published photo needs explicit conflict review');
check($blocked['next']->publicContent->committee[0]->photo==='assets/images/custom-committee.jpg','Custom photo was overwritten');
$clash=copy_value($live);$clash->units[0]->code='999999';
check(!content_refresh_plan($clash,$wanted,$base)['canApply'],'Existing code mismatch must block refresh');
$scope=content_refresh_plan($live,$wanted,$base,[['username'=>'stable-person','name'=>'นายชัยมงคล อินทรีย์','role'=>'mentor','team'=>3]]);
check($scope['accountReview'][0]['status']==='group-scope-review','Changed mentor group needs authority review');
echo "PASS content refresh preserves IDs, codes, evidence, custom content and account identity; conflicts and idempotence verified\n";
