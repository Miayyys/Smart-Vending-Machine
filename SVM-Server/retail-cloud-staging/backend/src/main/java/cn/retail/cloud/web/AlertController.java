package cn.retail.cloud.web;

import cn.retail.cloud.entity.AnomalyAlert;
import cn.retail.cloud.entity.RestockAlert;
import cn.retail.cloud.service.AlertService;
import cn.retail.cloud.service.CleanupService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/alerts")
public class AlertController {

    private final AlertService alertService;
    private final CleanupService cleanupService;
    public AlertController(AlertService a, CleanupService c){this.alertService=a; this.cleanupService=c;}

    @GetMapping("/restock")
    public List<RestockAlert> restock(@RequestParam(required=false) String status){
        return alertService.listRestock(status);
    }

    @PostMapping("/restock/{id}/ack")
    public RestockAlert ackRestock(@PathVariable Long id){
        return alertService.ackRestock(id)
                .orElseThrow(()->new IllegalArgumentException("alert not found: "+id));
    }

    @GetMapping("/anomaly")
    public List<AnomalyAlert> anomaly(@RequestParam(required=false) Boolean unhandledOnly){
        return alertService.listAnomaly(unhandledOnly);
    }

    /** 手动上报一条异常（联调用） */
    @PostMapping("/anomaly")
    public AnomalyAlert raise(@RequestBody java.util.Map<String,Object> body){
        String device = (String) body.get("deviceId");
        String type = (String) body.getOrDefault("type","UNKNOWN");
        String level = (String) body.getOrDefault("level","WARN");
        return alertService.raiseAnomaly(device, type, body.toString(), level);
    }

    /** 一键清空补货告警 */
    @DeleteMapping("/restock")
    public Map<String,Object> clearRestock() {
        int n = cleanupService.clearAllRestockAlerts();
        return Map.of("deleted", n);
    }

    /** 一键清空异常告警 */
    @DeleteMapping("/anomaly")
    public Map<String,Object> clearAnomaly() {
        int n = cleanupService.clearAllAnomalyAlerts();
        return Map.of("deleted", n);
    }
}