<?php
declare(strict_types=1);
namespace GECC;
function criteria(): object {
    static $data;
    return $data ??= decode(file_get_contents(__DIR__ . '/data/criteria.json'));
}
function blank_assess(): object {
    $c = criteria();
    return (object)['started'=>false, 'date'=>today(), 'round'=>1, 'inspector'=>'', 'inspectors'=>[], 'updatedAt'=>null,
        'phys'=>array_fill(0, count($c->PHYS), null),
        'qc'=>array_map(fn($q)=>(object)['subs'=>array_fill(0,count($q->subs),false),'score'=>null],$c->QC),
        'narr'=>array_map(fn($n)=>(object)['text'=>'','link'=>'','score'=>null],$c->NARR),
        'out'=>(object)['o11'=>null,'o12'=>null,'N'=>'','n'=>'','o13'=>null,'o14'=>null,
            'c21'=>array_fill(0,count($c->OUT->c21->items),false),'c22'=>null,'t3'=>array_fill(0,count($c->OUT->t3->items),false)]];
}
function numeric(mixed $v): float { return is_numeric($v) ? (float)$v : 0; }
function truthy(mixed $v): bool { return !($v === null || $v === false || $v === '' || $v === 0 || $v === 0.0); }
function calc(?object $a): ?array {
    if (!$a) return null;
    $c = criteria();
    $yes = count(array_filter($a->phys, fn($v)=>$v === true));
    $no = count(array_filter($a->phys, fn($v)=>$v === false));
    $qcList = [];
    foreach ($c->QC as $i=>$q) {
        $it = $a->qc[$i];
        $qcList[] = $it->score !== null && $it->score !== '' && is_numeric($it->score)
            ? max(0,min(10,numeric($it->score)))
            : floor(count(array_filter($it->subs, __NAMESPACE__.'\truthy')) / count($q->subs)*100 + .5)/10;
    }
    $qc = floor(array_sum($qcList)*10 + .5)/10;
    $narrList = array_map(fn($x)=>$x->score === null || $x->score === '' || !is_numeric($x->score) ? 0 : max(0,min(10,numeric($x->score))),$a->narr);
    $narr = array_sum($narrList);
    $o = $a->out;
    $sat = numeric($o->o11)+numeric($o->o12)+numeric($o->o13)+numeric($o->o14);
    $conv = count(array_filter($o->c21,__NAMESPACE__.'\truthy'))*3 + numeric($o->c22);
    $tech = count(array_filter($o->t3,__NAMESPACE__.'\truthy'))*3;
    $out = $sat+$conv+$tech;
    $quality = floor(($qc+$narr)*10 + .5)/10;
    $total = floor(($quality+$out)*10 + .5)/10;
    $level = $yes !== 15 ? 'gate' : ($total >= 280 ? 'gold' : ($total >= 260 ? 'silver' : ($total >= 240 ? 'blue' : 'below')));
    $newDone = 0;
    foreach ($c->PHYS as $i=>$p) if (!empty($p->n) && $a->phys[$i] === true) $newDone++;
    foreach ($c->QC as $i=>$q) foreach ($q->subs as $k=>$sub) if (!empty($sub->n) && truthy($a->qc[$i]->subs[$k])) $newDone++;
    return ['physYes'=>$yes,'physNo'=>$no,'physPending'=>15-$yes-$no,'physComplete'=>$yes===15,
        'qcList'=>$qcList,'qc'=>$qc,'narrList'=>$narrList,'narr'=>$narr,'sat'=>$sat,'conv'=>$conv,
        'tech'=>$tech,'out'=>$out,'quality'=>$quality,'total'=>$total,'level'=>$level,'newDone'=>$newDone];
}
function sub_of(?object $a): array {
    if (!$a || !$a->started) return array_fill_keys(['phys','qual','out','qc','narr'],'none');
    $ph = count(array_filter($a->phys,fn($v)=>$v !== null));
    $q1 = count(array_filter($a->qc,fn($q)=>count(array_filter($q->subs,__NAMESPACE__.'\truthy')) > 0 || ($q->score !== null && $q->score !== '')));
    $q2 = count(array_filter($a->narr,fn($q)=>$q->score !== null && $q->score !== ''));
    $o = count(array_filter(['o11','o12','o13','o14','c22'],fn($k)=>$a->out->$k !== null && $a->out->$k !== ''));
    $o += (int)(count(array_filter($a->out->c21,__NAMESPACE__.'\truthy'))>0) + (int)(count(array_filter($a->out->t3,__NAMESPACE__.'\truthy'))>0);
    $st = fn($v,$max)=>$v >= $max ? 'done' : ($v > 0 ? 'prog' : 'none');
    return ['phys'=>$st($ph,15),'qual'=>$st($q1+$q2,20),'out'=>$st($o,7),'qc'=>$st($q1,10),'narr'=>$st($q2,10)];
}
function ready_of(?object $a): array {
    $r = $a->ready ?? null;
    if (!$r) return ['st'=>'none','r'=>null];
    $c = $r->c ?? [];
    $answered = count($c)>=4;
    foreach ([0,1,2,3] as $i) $answered = $answered && in_array($c[$i] ?? null,['y','n'],true);
    $signed = is_string($r->name ?? null) && trim($r->name)!=='' && !empty($r->date);
    if (!$answered || !$signed) return ['st'=>count(array_filter($c,__NAMESPACE__.'\truthy')) || !empty($r->name) || !empty($r->kind) ? 'draft':'none','r'=>$r];
    return ['st'=>count(array_filter($c,fn($v)=>$v!=='y'))===0?'ready':'notready','r'=>$r];
}
function summary(object $s): array {
    $r = ['units'=>count($s->units),'teams'=>count($s->teams)] + array_fill_keys(['submitted','reviewed','ready','complete','pass','fix','risk','none'],0);
    $r['submission'] = array_fill_keys(['done','prog','none'],0);
    $r['readiness'] = array_fill_keys(['ready','notready','draft','none'],0);
    $r['crit'] = [
        'qc' => array_fill_keys(['done','prog','none'], 0),
        'narr' => array_fill_keys(['done','prog','none'], 0),
        'out' => array_fill_keys(['done','prog','none'], 0)
    ];
    $r['levels'] = array_fill_keys(['gold','silver','blue','below','gate','none'], 0);
    $r['phys'] = ['full'=>0, 'part'=>0, 'zero'=>0, 'bars'=>[]];
    $r['survey'] = ['tot'=>0, 'units'=>0, 'avg'=>array_fill_keys(['s3','s4','s5','c1','c2','c5'], null)];
    $r['scores'] = [];
    $r['lastUpdatedAt'] = null;

    $svWeights = array_fill_keys(['s3','s4','s5','c1','c2','c5'], 0.0);
    $svSums = array_fill_keys(['s3','s4','s5','c1','c2','c5'], 0.0);

    foreach ($s->units as $u) {
        $a = $s->assess->{$u->id} ?? null; $sub = sub_of($a);
        $complete = $sub['phys']==='done' && $sub['qual']==='done' && $sub['out']==='done';
        $r['submission'][$complete ? 'done' : (count(array_filter($sub,fn($v)=>$v!=='none')) ? 'prog' : 'none')]++;
        $r['readiness'][ready_of($a)['st']]++;
        if (!empty($a->updatedAt) && ($r['lastUpdatedAt']===null || $a->updatedAt>$r['lastUpdatedAt'])) $r['lastUpdatedAt']=$a->updatedAt;
        if (($a->wf->status ?? '')==='submitted') $r['submitted']++;
        if (($a->wf->status ?? '')==='reviewed') $r['reviewed']++;
        if (ready_of($a)['st']==='ready') $r['ready']++;

        foreach (['qc','narr','out'] as $ck) {
            $r['crit'][$ck][$sub[$ck]]++;
        }

        $pv = ($a && !empty($a->started)) ? count(array_filter($a->phys ?? [], fn($v)=>$v===true)) : 0;
        if ($pv === 15) $r['phys']['full']++;
        else if ($pv > 0) $r['phys']['part']++;
        else $r['phys']['zero']++;
        $r['phys']['bars'][] = ['name'=>$u->name, 'team'=>$u->team, 'v'=>$pv];

        if ($complete) {
            $r['complete']++; $c = calc($a);
            $open = count(array_filter($s->defects,fn($d)=>$d->unitId===$u->id && $d->status!=='closed'))>0;
            $r[!$c['physComplete'] || $c['total']<240 ? 'risk' : ($open?'fix':'pass')]++;
            $r['levels'][$c['level']]++;
            $r['scores'][] = ['total'=>$c['total'], 'level'=>$c['level'], 'name'=>$u->name];
        } else {
            $r['none']++;
            $r['levels']['none']++;
        }

        $sv = $a->survey ?? null;
        if ($sv && !empty($sv->n) && is_numeric($sv->n) && (float)$sv->n > 0) {
            $nVal = (float)$sv->n;
            $hasAny = false;
            foreach (['s3','s4','s5'] as $sk) {
                if (isset($sv->sat->$sk) && is_numeric($sv->sat->$sk)) {
                    $svSums[$sk] += (float)$sv->sat->$sk * $nVal;
                    $svWeights[$sk] += $nVal;
                    $hasAny = true;
                }
            }
            foreach (['c1','c2','c5'] as $ck) {
                if (isset($sv->conf->$ck) && is_numeric($sv->conf->$ck)) {
                    $svSums[$ck] += (float)$sv->conf->$ck * $nVal;
                    $svWeights[$ck] += $nVal;
                    $hasAny = true;
                }
            }
            if ($hasAny) {
                $r['survey']['tot'] += (int)$nVal;
                $r['survey']['units']++;
            }
        }
    }

    foreach (array_keys($r['survey']['avg']) as $k) {
        if ($svWeights[$k] > 0) {
            $r['survey']['avg'][$k] = round($svSums[$k] / $svWeights[$k], 2);
        }
    }

    usort($r['phys']['bars'], function($a, $b) {
        if ($b['v'] !== $a['v']) return $b['v'] <=> $a['v'];
        return $a['team'] <=> $b['team'];
    });

    return $r;
}
