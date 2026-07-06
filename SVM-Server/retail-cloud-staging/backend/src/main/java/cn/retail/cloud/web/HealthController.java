package cn.retail.cloud.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class HealthController {
    @GetMapping("/api/health")
    public Map<String,Object> health(){
        return Map.of("status","UP","time",System.currentTimeMillis());
    }
}