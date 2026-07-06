package cn.retail.cloud.web;

import cn.retail.cloud.entity.Stock;
import cn.retail.cloud.service.StockService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
public class StockController {

    private final StockService stockService;
    public StockController(StockService s){this.stockService=s;}

    @GetMapping("/devices/{id}/stock")
    public List<Stock> deviceStock(@PathVariable String id){
        return stockService.listStockOfDevice(id);
    }

    @GetMapping("/stock/low")
    public List<Stock> lowAll(){
        return stockService.lowStockAll();
    }

    /** 手塞/对齐库存（联调测试用），可触发补货告警 */
    @PostMapping("/stock/reconcile")
    public Stock reconcile(@RequestParam String deviceId,
                           @RequestParam Long productId,
                           @RequestParam(required=false) Integer qty,
                           @RequestParam(required=false) Integer threshold){
        return stockService.reconcile(deviceId,productId,qty,threshold)
                .orElseThrow(()->new IllegalArgumentException("no stock row and no qty given"));
    }
}